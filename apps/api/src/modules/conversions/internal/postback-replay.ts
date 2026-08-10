import type { RawPostbackRequest } from '../../providers/contracts/normalized';

/**
 * Rebuilds the request an adapter parses, from the archived row.
 *
 * **Processing re-parses the archive; it does not trust anything intake
 * computed.** The job carries a row id and nothing else (§13.2), so the only
 * input is what was stored — and that is what makes "fix the adapter, then
 * replay" a real recovery path rather than a slogan. Had intake stored the
 * parsed conversion instead, a parser bug would be baked into every row it
 * touched and no replay could undo it.
 *
 * The cost is stated plainly below: `rawBody` is not archived, so a scheme
 * that *parses* from the raw bytes cannot be replayed (TODO T23). No adapter
 * does; verification, which genuinely needs the bytes, happens at intake while
 * they are still in hand.
 */
export function toRawRequest(input: {
  payload: unknown;
  headers: unknown;
  sourceIp: string | null;
}): RawPostbackRequest {
  const payload = asRecord(input.payload);

  return {
    query: asQuery(payload.query),
    body: payload.body ?? null,
    headers: asHeaders(input.headers),
    // Preserved so a rule keyed on the source can be re-evaluated during an
    // investigation. Empty, never a placeholder an adapter might match on.
    sourceIp: input.sourceIp ?? '',
  };
}

/** The method as archived, for logging and for the admin screen. */
export function archivedMethod(payload: unknown): string {
  const method = asRecord(payload).method;
  return typeof method === 'string' ? method : 'UNKNOWN';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Restores the `string | string[]` shape an adapter expects.
 *
 * Repeated parameters survived the archive as arrays because a repeat is the
 * shape of a parameter-pollution attempt, and an adapter that takes a repeat
 * as hostile can only do so if it can still see one.
 */
function asQuery(value: unknown): Record<string, string | string[]> {
  const source = asRecord(value);
  const query: Record<string, string | string[]> = {};

  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'string') {
      query[key] = item;
    } else if (Array.isArray(item)) {
      query[key] = item.filter((entry): entry is string => typeof entry === 'string');
    }
  }

  return query;
}

function asHeaders(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const headers: Record<string, string> = {};

  for (const [key, item] of Object.entries(source)) {
    if (typeof item === 'string') headers[key] = item;
  }

  return headers;
}
