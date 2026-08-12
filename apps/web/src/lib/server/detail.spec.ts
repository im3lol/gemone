import { describe, expect, it } from 'vitest';

import { apiPath, type ApiFailure } from './api';
import { failedDetailLoad } from './detail';

/**
 * The two halves of TODO T86.
 *
 * `apiPath` is the one that mattered: a template literal let a value from the
 * address bar choose which API endpoint an authenticated admin request reached.
 * `failedDetailLoad` is the one T86 was filed about — a 502 for a mistyped
 * reference.
 */

const COPY = { malformed: 'not a reference', missing: 'no such thing' };

const failure = (status: number, message = 'something'): ApiFailure => ({
  status,
  code: 'X',
  message,
});

/** SvelteKit's `error`/`redirect` throw; this reads what came out. */
function thrownBy(run: () => never): { status?: number; body?: unknown; location?: string } {
  try {
    run();
  } catch (thrown) {
    return thrown as { status?: number; body?: unknown; location?: string };
  }

  throw new Error('expected a throw');
}

describe('apiPath', () => {
  it('leaves an ordinary identifier alone', () => {
    expect(apiPath`/admin/payouts/${'019ff3a1-ee28-74fc-a861-ce1068df96cf'}`).toBe(
      '/admin/payouts/019ff3a1-ee28-74fc-a861-ce1068df96cf',
    );
  });

  it('stops a path segment climbing to another endpoint', () => {
    /*
     * The defect. `/admin/payouts/../users` is resolved to `/admin/users` by
     * URL parsing before the request leaves the process, so the page fetched
     * the admin user list, got a 200, and crashed rendering a paginated list
     * as a payout.
     */
    const path = apiPath`/admin/payouts/${'../users'}`;

    expect(path).toBe('/admin/payouts/..%2Fusers');
    expect(new URL(path, 'http://api').pathname).toBe('/admin/payouts/..%2Fusers');
  });

  it('stops a segment that URL parsing would silently trim', () => {
    // A trailing space is stripped by WHATWG parsing, so `/admin/payouts/ `
    // became `/admin/payouts/` — the *list* endpoint — and crashed the same way.
    const path = apiPath`/admin/payouts/${' '}`;

    expect(new URL(path, 'http://api').pathname).toBe('/admin/payouts/%20');
  });

  it('stops a segment starting a query string or a fragment', () => {
    expect(new URL(apiPath`/admin/payouts/${'x?status=PAID'}`, 'http://api').search).toBe('');
    expect(new URL(apiPath`/admin/payouts/${'x#frag'}`, 'http://api').hash).toBe('');
  });

  it('encodes every value, not only the first', () => {
    expect(apiPath`/a/${'../x'}/b/${'../y'}`).toBe('/a/..%2Fx/b/..%2Fy');
  });

  it('keeps separators written in the template', () => {
    // Static parts are the author's; only the interpolations are the caller's.
    expect(apiPath`/admin/payouts/${'abc'}/approve`).toBe('/admin/payouts/abc/approve');
  });

  it('treats a missing value as empty rather than as the string "undefined"', () => {
    // `params.id` is always present for a matched route, but an action reading a
    // form field is not so lucky, and `/admin/fraud/held/undefined/review` is a
    // request that looks legitimate in a log.
    expect(apiPath`/a/${undefined}/b`).toBe('/a//b');
    expect(apiPath`/a/${null}/b`).toBe('/a//b');
  });
});

describe('failedDetailLoad', () => {
  it('sends an ended session to the login form rather than to an error page', () => {
    const thrown = thrownBy(() => failedDetailLoad(failure(401), COPY));

    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe('/login');
  });

  it('keeps a forbidden resource forbidden, not missing', () => {
    // Telling a signed-in non-admin "not found" would say something untrue
    // about a resource that exists, and make their own mistake harder to see.
    expect(thrownBy(() => failedDetailLoad(failure(403), COPY)).status).toBe(403);
  });

  it('answers a malformed identifier with 404, not 502 — the bug T86 names', () => {
    /*
     * `createUuidPipe` answers 422, and these loads send no body and no query,
     * so a 422 can only be about the id. It was reported as a bad gateway,
     * which blames the API for a URL somebody mistyped.
     */
    const thrown = thrownBy(() => failedDetailLoad(failure(422, 'uuid is expected'), COPY));

    expect(thrown.status).toBe(404);
    expect(thrown.body).toMatchObject({ message: COPY.malformed });
  });

  it('distinguishes a malformed identifier from one that names nothing', () => {
    // Both are 404 to the reader, and they lead somewhere different: check what
    // you pasted, versus this request has been dealt with.
    const malformed = thrownBy(() => failedDetailLoad(failure(422), COPY));
    const missing = thrownBy(() => failedDetailLoad(failure(404), COPY));

    expect(malformed.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(malformed.body).not.toEqual(missing.body);
  });

  it('keeps an upstream failure a server failure', () => {
    // A broken API disguised as a missing record is an outage nobody sees until
    // they wonder why every reference stopped resolving.
    expect(thrownBy(() => failedDetailLoad(failure(500), COPY)).status).toBe(502);
    expect(thrownBy(() => failedDetailLoad(failure(502), COPY)).status).toBe(502);
  });

  it('passes an unreachable API through as 503', () => {
    // `apiAuthed` returns 503 when it could not reach the API at all, and
    // "busy, try again" is actionable in a way that 502 is not.
    expect(thrownBy(() => failedDetailLoad(failure(503), COPY)).status).toBe(503);
  });

  it('does not turn an unexpected 4xx into a missing record', () => {
    // A 409 on a GET means the contract moved. Reporting it as "not found"
    // would hide a real mismatch behind a plausible page.
    expect(thrownBy(() => failedDetailLoad(failure(409), COPY)).status).toBe(502);
  });

  it('never puts the API message on a 404, so nothing internal leaks into copy', () => {
    const thrown = thrownBy(() =>
      failedDetailLoad(failure(404, 'Payout request not found in shard 3'), COPY),
    );

    expect(JSON.stringify(thrown.body)).not.toContain('shard 3');
  });
});
