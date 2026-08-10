/**
 * Turning an inbound HTTP request into the two JSON columns the archive keeps.
 *
 * Everything here is defensive in the same direction: the input arrives from
 * the public internet, and `provider_postbacks` is the table that will grow
 * fastest in the system. An unbounded field is a column somebody fills with a
 * megabyte, once per event.
 */

/** Per captured string. Long enough for a real payload, short enough to bound the row. */
const MAX_VALUE = 2048;

/** Query and body keys kept. A provider sending hundreds is doing something else. */
const MAX_KEYS = 128;

/**
 * Headers worth archiving.
 *
 * An **allowlist**, not a denylist of known-secret names. A denylist keeps
 * whatever it did not think of, and "whatever it did not think of" includes
 * the day a provider decides to authenticate with a bearer token — at which
 * point their credential is in our database, our backups and our replicas,
 * which DATABASE.md §1 exists to prevent.
 *
 * The cost is that a provider signing via a custom header would have that
 * header dropped from the archive. No adapter does; the first one that does
 * adds its header name here, next to its own entry (TODO T22).
 */
const CAPTURED_HEADERS = [
  'content-type',
  'user-agent',
  'host',
  'referer',
  'x-forwarded-for',
  'x-real-ip',
  'x-request-id',
  'date',
] as const;

/** What arrived, in the shape the `payload` column stores. */
export interface CapturedPayload {
  method: string;
  query: Record<string, string | string[]>;
  body: unknown;
}

export function capturePayload(input: {
  method: string;
  query: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
}): CapturedPayload {
  return {
    method: input.method.toUpperCase().slice(0, 16),
    query: captureQuery(input.query),
    body: captureBody(input.body),
  };
}

export function captureHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const captured: Record<string, string> = {};

  for (const name of CAPTURED_HEADERS) {
    const value = headers[name];
    const text = Array.isArray(value) ? value.join(', ') : value;

    if (typeof text === 'string' && text.length > 0) {
      captured[name] = text.slice(0, MAX_VALUE);
    }
  }

  return captured;
}

/**
 * Query parameters, with repeats preserved.
 *
 * A repeated parameter is legal HTTP and is also the shape of a
 * parameter-pollution attempt against a signature check. The adapter decides
 * what to do with one; the archive's job is to record that it happened, so
 * flattening `?payout=1.00&payout=99.00` to either value would destroy the
 * only evidence that both were sent.
 */
function captureQuery(
  query: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string | string[]> {
  const captured: Record<string, string | string[]> = {};
  let keys = 0;

  for (const [key, value] of Object.entries(query)) {
    if (keys >= MAX_KEYS) break;
    if (value === undefined) continue;

    captured[key.slice(0, MAX_VALUE)] = Array.isArray(value)
      ? value.slice(0, MAX_KEYS).map((item) => item.slice(0, MAX_VALUE))
      : value.slice(0, MAX_VALUE);

    keys += 1;
  }

  return captured;
}

/**
 * The body, bounded and made storable.
 *
 * Depth is capped rather than trusted: a deeply nested body is cheap to send
 * and expensive to serialise, and `JSON.stringify` on a cyclic object throws —
 * inside the handler, after we have already decided to archive.
 */
function captureBody(body: unknown, depth = 0): unknown {
  if (body === null || body === undefined) return null;

  if (typeof body === 'string') return body.slice(0, MAX_VALUE);
  if (typeof body === 'number' || typeof body === 'boolean') return body;

  // Anything past here is a container, and a container at the depth limit is
  // recorded as the fact that it was there rather than dropped silently.
  if (depth >= 4) return '[truncated]';

  if (Buffer.isBuffer(body)) return body.toString('utf8').slice(0, MAX_VALUE);

  if (Array.isArray(body)) {
    return body.slice(0, MAX_KEYS).map((item) => captureBody(item, depth + 1));
  }

  if (typeof body === 'object') {
    const captured: Record<string, unknown> = {};
    let keys = 0;

    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (keys >= MAX_KEYS) break;
      captured[key.slice(0, MAX_VALUE)] = captureBody(value, depth + 1);
      keys += 1;
    }

    return captured;
  }

  // Functions and symbols cannot arrive over HTTP; recorded rather than
  // crashing the handler if one ever does.
  return '[unsupported]';
}

/** One line, safe to store and to show an admin. Never a stack trace (§15.3). */
export function summarizeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 500);
}

export const __testing = { captureQuery, captureBody, CAPTURED_HEADERS, MAX_VALUE, MAX_KEYS };
