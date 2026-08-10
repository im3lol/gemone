import { isIP } from 'node:net';

/**
 * Validates a postback source range — an IPv4/IPv6 address, optionally with a
 * CIDR prefix.
 *
 * Written rather than pulled in. The matching half below is the other end of
 * the same decision (TODO T5, now due): a range validated on write and never
 * matched against anything is a range that silently matches nothing, which
 * quarantines every postback from a legitimate provider.
 *
 * Delegates address parsing to `node:net`, which already implements it
 * correctly — including the IPv6 forms that hand-rolled regexes get wrong.
 */
export function isValidIpRange(value: string): boolean {
  if (value !== value.trim() || value.length === 0) return false;

  const parts = value.split('/');
  if (parts.length > 2) return false;

  const address = parts[0] ?? '';
  const version = isIP(address);
  if (version === 0) return false;

  const prefix = parts[1];
  if (prefix === undefined) return true;

  // Rejected explicitly rather than via Number(): `Number('')` is 0 and
  // `Number(' 8')` is 8, so a bare "1.2.3.4/" would otherwise validate as /0
  // — a range matching the entire internet.
  if (!/^\d{1,3}$/.test(prefix)) return false;

  const bits = Number(prefix);
  return bits >= 0 && bits <= (version === 4 ? 32 : 128);
}

/**
 * Slugs are the registry's lookup key and appear in URLs and environment
 * variable names, so the character set is deliberately narrow: lowercase
 * alphanumerics and single hyphens, never leading or trailing.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidProviderSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 32 && SLUG_PATTERN.test(value);
}

// --- Matching (ARCHITECTURE.md §10.1, step 3) -----------------------------

/**
 * Does this address fall inside any of these ranges?
 *
 * **An empty list returns false**, and the decision about what that means
 * belongs to the caller. On the provider row, no ranges means "do not check
 * the source" — a defensible setting for a cryptographically signed scheme
 * and a dangerous default to bury in here, where nobody reading the postback
 * handler would see it.
 */
export function ipMatchesAnyRange(address: string, ranges: readonly string[]): boolean {
  return ranges.some((range) => ipMatchesRange(address, range));
}

/**
 * Does this address fall inside this range?
 *
 * Returns false for anything it cannot parse rather than throwing. Both
 * inputs are untrusted from different directions — the address arrives from
 * the network, the range from an operator's typing — and an allowlist that
 * throws on bad input fails *open* at whichever layer catches the exception.
 */
export function ipMatchesRange(address: string, range: string): boolean {
  const target = parseAddress(address.trim());
  if (!target) return false;

  const [rawNetwork = '', rawPrefix, ...rest] = range.trim().split('/');
  if (rest.length > 0) return false;

  const network = parseAddress(rawNetwork);
  if (!network || network.version !== target.version) return false;

  /*
   * Prefix width is read from how the range was *written*, not from what it
   * normalised to. `::ffff:203.0.113.0/120` is an IPv4 /24 expressed in IPv6
   * notation; measuring its prefix against 32 bits would silently widen it to
   * the entire address space.
   */
  const writtenWidth = rawNetwork.includes(':') ? 128 : 32;

  let bits = writtenWidth;
  if (rawPrefix !== undefined) {
    if (!/^\d{1,3}$/.test(rawPrefix)) return false;
    bits = Number(rawPrefix);
    if (bits > writtenWidth) return false;
  }

  // The first 96 bits of an IPv4-mapped address are the fixed prefix, so a
  // /120 written in IPv6 is a /24 once unwrapped.
  if (network.unwrapped) bits -= 96;
  if (bits < 0) return false;

  return sharesPrefix(target.bytes, network.bytes, bits);
}

interface ParsedAddress {
  version: 4 | 6;
  bytes: Uint8Array;
  /** True when IPv6 text turned out to be an IPv4-mapped address. */
  unwrapped: boolean;
}

/**
 * Parses an address into bytes, unwrapping the IPv4-mapped IPv6 form.
 *
 * The unwrapping is not a nicety. A Node server listening on a dual-stack
 * socket reports an IPv4 client as `::ffff:203.0.113.10`, so without it every
 * postback from a provider whose published ranges are ordinary IPv4 CIDRs
 * would fail the allowlist — on some deployments and not others, depending on
 * how the socket was bound.
 */
function parseAddress(value: string): ParsedAddress | null {
  if (value.includes(':')) {
    const bytes = parseIpv6(value);
    if (!bytes) return null;

    if (isIpv4Mapped(bytes)) {
      return { version: 4, bytes: bytes.subarray(12), unwrapped: true };
    }
    return { version: 6, bytes, unwrapped: false };
  }

  const bytes = parseIpv4(value);
  return bytes ? { version: 4, bytes, unwrapped: false } : null;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/** Leading zeros are rejected: `010` is ten here and eight to some parsers. */
const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;

function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);

  for (let index = 0; index < 4; index += 1) {
    const part = parts[index] ?? '';
    if (!IPV4_OCTET.test(part)) return null;

    const octet = Number(part);
    if (octet > 255) return null;

    bytes[index] = octet;
  }

  return bytes;
}

function parseIpv6(value: string): Uint8Array | null {
  // A zone index (`fe80::1%eth0`) is local to the host that produced it and
  // means nothing in a range comparison.
  const zone = value.indexOf('%');
  const text = zone === -1 ? value : value.slice(0, zone);

  const elision = text.indexOf('::');

  let head: string[];
  let tail: string[];

  if (elision === -1) {
    head = text.split(':');
    tail = [];
  } else {
    // Two elisions are ambiguous — `1::2::3` could expand several ways.
    if (text.indexOf('::', elision + 1) !== -1) return null;

    head = splitGroups(text.slice(0, elision));
    tail = splitGroups(text.slice(elision + 2));
  }

  // A trailing dotted quad (`::ffff:192.0.2.1`) occupies the last two groups.
  let embedded: Uint8Array | null = null;
  const last = tail.length > 0 ? tail.at(-1) : head.at(-1);

  if (last !== undefined && last.includes('.')) {
    embedded = parseIpv4(last);
    if (!embedded) return null;

    if (tail.length > 0) tail = tail.slice(0, -1);
    else head = head.slice(0, -1);
  }

  const groups = head.length + tail.length + (embedded ? 2 : 0);

  if (elision === -1) {
    if (groups !== 8) return null;
  } else if (groups > 7) {
    // `::` must stand for at least one group, or it is just a stray colon.
    return null;
  }

  const bytes = new Uint8Array(16);
  let offset = 0;

  for (const group of head) {
    const word = parseGroup(group);
    if (word === null) return null;
    bytes[offset++] = word >> 8;
    bytes[offset++] = word & 0xff;
  }

  // The elision expands to whatever is left over, which is zero when absent.
  offset += 16 - groups * 2;

  for (const group of tail) {
    const word = parseGroup(group);
    if (word === null) return null;
    bytes[offset++] = word >> 8;
    bytes[offset++] = word & 0xff;
  }

  if (embedded) bytes.set(embedded, offset);

  return bytes;
}

function splitGroups(segment: string): string[] {
  return segment === '' ? [] : segment.split(':');
}

function parseGroup(value: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(value)) return null;
  return Number.parseInt(value, 16);
}

/** Compares the leading `bits` of two equal-length byte strings. */
function sharesPrefix(left: Uint8Array, right: Uint8Array, bits: number): boolean {
  const wholeBytes = bits >> 3;

  for (let index = 0; index < wholeBytes; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  const remainder = bits & 7;
  if (remainder === 0) return true;

  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((left[wholeBytes] ?? 0) & mask) === ((right[wholeBytes] ?? 0) & mask);
}

export const __testing = { parseAddress, sharesPrefix };
