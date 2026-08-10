import type { RequestHandler } from './$types';

import { apiAuthed, type ApiFailure } from '$lib/server/api';

/**
 * The admin API, reachable through the web origin — ARCHITECTURE.md §6.1, §19.1.
 *
 * ## Why this exists
 *
 * In production only Caddy is published: `api` has no port, and Caddy sends
 * everything except `/postback/*` and `/health*` to `web` (§19.1). Every
 * `/admin/*` endpoint was therefore unreachable from the internet — a provider
 * could not be registered, no configuration value could be changed, no fraud
 * hold could be released. The offer wall is empty until a provider exists, so
 * this was not a missing screen; it was the money flow with no way to start it.
 *
 * ## Why a generic proxy rather than a route per endpoint
 *
 * There are fifteen admin endpoints and they are not the interesting part: each
 * one would be the same eight lines of forwarding, and a screen added later
 * would need a second file before it could call anything. This forwards; it
 * decides nothing.
 *
 * ## What keeps it from being an open proxy
 *
 * The target path is **built** here as `/admin/…` and never taken from the
 * caller, so this cannot be pointed at `/auth/login` or `/users/me`. A path
 * segment that tries to climb out is refused rather than normalised.
 *
 * ## Authorization stays at the API
 *
 * Deliberately no role check in this file. Every `/admin/*` endpoint carries
 * `@Roles(ADMIN)` and the API verifies the bearer token it is handed — so a
 * signed-in non-admin who calls this gets the API's own 403, and `web` never
 * becomes the thing that decides who is an admin. The layout guard on the admin
 * *pages* is a redirect for rendering's sake and is not a security control;
 * `+server.ts` endpoints do not run layouts at all, which is why this file must
 * not rely on one.
 *
 * ## Cross-site requests
 *
 * The session cookie is `SameSite=Lax`, so a POST from another origin carries
 * no cookie and arrives here unauthenticated. That is what stands in for CSRF
 * tokens, and it is the same protection every form action in this app relies on.
 */
const proxy: RequestHandler = async (event) => {
  const { params, request, url } = event;
  const path = params.path;

  /*
   * `..` never reaches the API.
   *
   * `fetch` resolves `/admin/../auth/login` to `/auth/login` before it leaves
   * this process, which would turn the prefix above into a suggestion. Refused
   * outright rather than stripped: there is no legitimate admin path with a
   * `..` in it, so rejecting is both simpler and impossible to get subtly wrong.
   */
  if (!path || path.split('/').includes('..')) {
    return failure({ status: 404, code: 'NOT_FOUND', message: 'Unknown admin endpoint' });
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.text() : undefined;

  const result = await apiAuthed(event, `/admin/${path}${url.search}`, {
    method: request.method,
    // Only when there is one: `apiAuthed` sets the JSON content type from the
    // presence of a body, and an empty string would send a header describing a
    // document that is not there.
    ...(body ? { body } : {}),
  });

  // No session at all, or one the API refused twice — `apiAuthed` has already
  // cleared the cookie in that case.
  if (!result.ok) return failure(result.failure);

  const response = result.value;

  /*
   * The API's answer, passed through unchanged.
   *
   * Status included: a 403 from `@Roles(ADMIN)`, a 422 from a validation pipe
   * and a 409 from a uniqueness constraint all mean something specific to the
   * caller, and a proxy that flattened them would make the admin API less
   * useful through the only door it has.
   *
   * Headers are **not** forwarded wholesale. `Set-Cookie` in particular belongs
   * to the session exchange `apiAuthed` already handled; replaying it to the
   * browser would put the API's refresh cookie — a credential the BFF exists to
   * keep server-side (§6.1) — into the browser's jar.
   */
  const payload = await response.text();
  const contentType = response.headers.get('content-type');

  return new Response(bodyFor(response.status, payload), {
    status: response.status,
    headers: contentType ? { 'content-type': contentType } : {},
  });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

/**
 * `204` and `304` may not carry a body, and constructing a `Response` that does
 * throws — which would turn every successful delete into a 500.
 */
function bodyFor(status: number, payload: string): string | null {
  if (status === 204 || status === 304) return null;
  return payload === '' ? null : payload;
}

/** The same envelope the API uses (§15.3), so one client handles both. */
function failure(apiFailure: ApiFailure): Response {
  return new Response(
    JSON.stringify({
      error: { code: apiFailure.code, message: apiFailure.message },
    }),
    { status: apiFailure.status, headers: { 'content-type': 'application/json' } },
  );
}
