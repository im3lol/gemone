import { describe, expect, it } from 'vitest';

import { ipMatchesAnyRange, ipMatchesRange, isValidIpRange, isValidProviderSlug } from './ip-range';

describe('isValidIpRange', () => {
  it.each([
    '203.0.113.10',
    '203.0.113.0/24',
    '10.0.0.0/8',
    '0.0.0.0/0',
    '2001:db8::1',
    '2001:db8::/32',
    '::1/128',
  ])('accepts %s', (value) => {
    expect(isValidIpRange(value)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['not-an-ip', 'not an address'],
    ['203.0.113.256', 'octet out of range'],
    ['203.0.113.0/33', 'prefix beyond IPv4 width'],
    ['2001:db8::/129', 'prefix beyond IPv6 width'],
    ['203.0.113.0/', 'empty prefix'],
    ['203.0.113.0/24/8', 'two prefixes'],
    ['203.0.113.0/ 24', 'whitespace in prefix'],
    [' 203.0.113.0', 'untrimmed'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidIpRange(value)).toBe(false);
  });

  it('rejects a bare slash rather than reading it as /0', () => {
    /*
     * The reason the prefix is matched against a digit pattern instead of
     * being passed to Number(): `Number('')` is 0, so "203.0.113.0/" would
     * validate as a /0 — a range matching the entire internet, silently
     * granted to whoever typed a stray slash.
     */
    expect(isValidIpRange('203.0.113.0/')).toBe(false);
    expect(isValidIpRange('203.0.113.0/0')).toBe(true);
  });
});

describe('isValidProviderSlug', () => {
  it.each(['mock', 'acme-eu', 'net2', 'a1-b2-c3'])('accepts %s', (value) => {
    expect(isValidProviderSlug(value)).toBe(true);
  });

  it.each([
    'a',
    'Mock',
    'has_underscore',
    '-leading',
    'trailing-',
    'double--hyphen',
    'has space',
    'x'.repeat(33),
  ])('rejects %s', (value) => {
    // The slug is a lookup key, a configuration scope id, and part of an
    // environment variable name. A permissive character set here becomes a
    // bug in all three.
    expect(isValidProviderSlug(value)).toBe(false);
  });
});

/**
 * The matching half — ARCHITECTURE.md §10.1, step 3.
 *
 * This is the check standing between a public endpoint and a provider's
 * identity, so it is tested from both directions: everything that must match
 * does, and everything that must not, does not. A permissive bug here reads
 * as "the allowlist is configured" while allowing the whole internet.
 */
describe('ipMatchesRange', () => {
  describe('IPv4', () => {
    it.each([
      ['203.0.113.10', '203.0.113.0/24'],
      ['203.0.113.0', '203.0.113.0/24'],
      ['203.0.113.255', '203.0.113.0/24'],
      ['10.4.5.6', '10.0.0.0/8'],
      ['198.51.100.7', '198.51.100.7'],
      ['198.51.100.7', '198.51.100.7/32'],
      ['1.2.3.4', '0.0.0.0/0'],
      ['192.168.1.129', '192.168.1.128/25'],
    ])('matches %s against %s', (address, range) => {
      expect(ipMatchesRange(address, range)).toBe(true);
    });

    it.each([
      ['203.0.114.10', '203.0.113.0/24'],
      ['203.0.112.255', '203.0.113.0/24'],
      ['11.0.0.1', '10.0.0.0/8'],
      ['198.51.100.8', '198.51.100.7'],
      ['192.168.1.127', '192.168.1.128/25'],
    ])('refuses %s against %s', (address, range) => {
      expect(ipMatchesRange(address, range)).toBe(false);
    });

    it('honours a prefix that does not fall on a byte boundary', () => {
      // /31 is two addresses. Rounding a prefix up to the nearest byte is the
      // classic hand-rolled-CIDR bug, and it widens the allowlist by 256×.
      expect(ipMatchesRange('203.0.113.4', '203.0.113.4/31')).toBe(true);
      expect(ipMatchesRange('203.0.113.5', '203.0.113.4/31')).toBe(true);
      expect(ipMatchesRange('203.0.113.6', '203.0.113.4/31')).toBe(false);
    });

    it('does not treat host bits in the range as significant', () => {
      // `203.0.113.77/24` names the same network as `203.0.113.0/24`. An
      // operator writing the address they were given must not get an
      // allowlist that matches nothing.
      expect(ipMatchesRange('203.0.113.10', '203.0.113.77/24')).toBe(true);
    });
  });

  describe('the IPv4-mapped IPv6 form', () => {
    /*
     * The failure this prevents is deployment-dependent, which is the worst
     * kind. Node reports an IPv4 client on a dual-stack socket as
     * `::ffff:203.0.113.10`; without unwrapping, every postback from a
     * provider whose published ranges are ordinary IPv4 CIDRs is refused —
     * on some hosts and not others.
     */
    it('matches a mapped address against a plain IPv4 range', () => {
      expect(ipMatchesRange('::ffff:203.0.113.10', '203.0.113.0/24')).toBe(true);
      expect(ipMatchesRange('::ffff:203.0.114.10', '203.0.113.0/24')).toBe(false);
    });

    it('reads a mapped range in IPv6 bit-space, not IPv4', () => {
      // /120 of an IPv4-mapped range is a /24, not "the whole internet".
      expect(ipMatchesRange('203.0.113.10', '::ffff:203.0.113.0/120')).toBe(true);
      expect(ipMatchesRange('203.0.114.10', '::ffff:203.0.113.0/120')).toBe(false);
    });
  });

  describe('IPv6', () => {
    it.each([
      ['2001:db8::1', '2001:db8::/32'],
      ['2001:db8:0:0:0:0:0:1', '2001:db8::/32'],
      ['2001:db8:1234:5678::abcd', '2001:db8::/32'],
      ['::1', '::1'],
      ['fe80::1%eth0', 'fe80::/10'],
      ['2001:db8::1', '::/0'],
    ])('matches %s against %s', (address, range) => {
      expect(ipMatchesRange(address, range)).toBe(true);
    });

    it.each([
      ['2001:db9::1', '2001:db8::/32'],
      ['2001:db8::2', '2001:db8::1'],
      ['2001:db8:8000::1', '2001:db8::/33'],
    ])('refuses %s against %s', (address, range) => {
      expect(ipMatchesRange(address, range)).toBe(false);
    });
  });

  describe('refusing rather than guessing', () => {
    it('never matches across address families', () => {
      // A v6 range on a v4 provider is a misconfiguration, not a wildcard.
      expect(ipMatchesRange('203.0.113.10', '::/0')).toBe(false);
      expect(ipMatchesRange('2001:db8::1', '0.0.0.0/0')).toBe(false);
    });

    it.each([
      ['not-an-address', '203.0.113.0/24'],
      ['203.0.113.10', 'not-a-range'],
      ['203.0.113.10', '203.0.113.0/33'],
      ['2001:db8::1', '2001:db8::/129'],
      ['203.0.113.10', '203.0.113.0/'],
      ['203.0.113.10', '203.0.113.0/24/8'],
      ['203.0.113.10', ''],
      ['', '203.0.113.0/24'],
      ['1.2.3.4.5', '0.0.0.0/0'],
      ['010.0.113.10', '10.0.113.0/24'],
      ['203.0.113.10', '203.0.113.0/-1'],
      ['1::2::3', '::/0'],
    ])('returns false for (%s, %s) instead of throwing', (address, range) => {
      /*
       * Both inputs are untrusted, from different directions: the address
       * arrives from the network, the range from an operator's typing. An
       * allowlist that throws on bad input fails *open* at whichever layer
       * catches the exception.
       */
      expect(() => ipMatchesRange(address, range)).not.toThrow();
      expect(ipMatchesRange(address, range)).toBe(false);
    });

    it('tolerates surrounding whitespace on both sides', () => {
      expect(ipMatchesRange(' 203.0.113.10 ', ' 203.0.113.0/24 ')).toBe(true);
    });
  });

  describe('every range validated on write is a range that can be matched', () => {
    it.each([
      '203.0.113.10',
      '203.0.113.0/24',
      '10.0.0.0/8',
      '0.0.0.0/0',
      '2001:db8::/32',
      '::1',
    ])('accepts %s in both halves', (range) => {
      /*
       * The two functions are one feature. A range `isValidIpRange` accepts
       * but `ipMatchesRange` cannot parse would pass an admin's validation
       * and then silently match nothing — which quarantines every postback
       * from a legitimate provider, with the reason buried in a config field
       * nobody re-reads.
       */
      expect(isValidIpRange(range)).toBe(true);

      const network = range.split('/')[0]!;
      expect(ipMatchesRange(network, range)).toBe(true);
    });
  });
});

describe('ipMatchesAnyRange', () => {
  const ranges = ['203.0.113.0/24', '198.51.100.7', '2001:db8::/32'];

  it('matches when any range matches', () => {
    expect(ipMatchesAnyRange('203.0.113.10', ranges)).toBe(true);
    expect(ipMatchesAnyRange('198.51.100.7', ranges)).toBe(true);
    expect(ipMatchesAnyRange('2001:db8::99', ranges)).toBe(true);
  });

  it('refuses when none do', () => {
    expect(ipMatchesAnyRange('192.0.2.1', ranges)).toBe(false);
  });

  it('refuses on an empty list', () => {
    /*
     * "No ranges" means "do not check" — but that decision belongs to the
     * provider row's owner, not here. A permissive default buried in a
     * matcher is how an allowlist becomes decorative without anyone deciding
     * that it should.
     */
    expect(ipMatchesAnyRange('203.0.113.10', [])).toBe(false);
  });

  it('is unaffected by one malformed entry among good ones', () => {
    // An operator typo must not disable the ranges that are correct.
    expect(ipMatchesAnyRange('203.0.113.10', ['garbage', '203.0.113.0/24'])).toBe(true);
  });
});
