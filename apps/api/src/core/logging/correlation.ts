import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Correlation — ARCHITECTURE.md §16.2.
 *
 * One id per request, generated at the edge if the caller did not supply one,
 * attached to every log line, and returned in the response header. Jobs will
 * inherit the id of the request that enqueued them, which is what makes a
 * postback traceable from HTTP receipt through worker processing to reward
 * credit in a single query.
 */
export const CORRELATION_ID_HEADER = 'x-request-id';

/** Where the id is stashed on the request object. */
const CORRELATION_ID_KEY = Symbol.for('gemone.correlationId');

interface CorrelatedRequest extends IncomingMessage {
  [CORRELATION_ID_KEY]?: string;
}

/**
 * Returns the request's correlation id, generating and attaching one on first
 * access.
 *
 * Accepting an inbound `x-request-id` lets the SvelteKit BFF (§6.1) pass its
 * own id through, so one user action has one id across both processes. The
 * value is length-capped and stripped of anything unprintable: it arrives from
 * outside and ends up in log lines, which is a log-injection vector otherwise.
 */
export function getCorrelationId(request: unknown): string {
  const req = request as CorrelatedRequest | undefined;

  if (!req || typeof req !== 'object') {
    return randomUUID();
  }

  const existing = req[CORRELATION_ID_KEY];
  if (existing) return existing;

  const id = sanitize(req.headers?.[CORRELATION_ID_HEADER]) ?? randomUUID();
  req[CORRELATION_ID_KEY] = id;
  return id;
}

function sanitize(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;

  const cleaned = value.replace(/[^\w.-]/g, '').slice(0, 128);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Exported for tests. */
export const __testing = { sanitize, CORRELATION_ID_KEY };
