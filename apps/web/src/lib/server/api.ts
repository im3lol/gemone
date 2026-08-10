import type { Cookies } from '@sveltejs/kit';
import type { ApiErrorResponse, AuthResponse, FieldError, UserProfile } from '@gemone/contracts';

import { apiBaseUrl, useSecureCookies } from './env';
import { clearSession, readSession, writeSession, type Session } from './session';

/**
 * The BFF proxy — ARCHITECTURE.md §6.1, §6.2 steps 3–4.
 *
 * The browser never calls the API. It calls a SvelteKit server route, which
 * reads the `httpOnly` session cookie and forwards the call with a bearer
 * token over the internal network. Everything the browser sees is same-origin,
 * so there is no CORS and no token in reachable storage.
 *
 * **The proxy forwards; it does not transform.** §6.1's cost/benefit only
 * holds while this layer stays thin — the moment it reshapes responses or
 * decides business questions, there are two places to change when a rule
 * changes and one of them has no tests over real data.
 */

/** The refresh cookie the API sets. Must match `apps/api` `auth.constants.ts`. */
const API_REFRESH_COOKIE = 'gemone_rt';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  /** Present for validation failures only (§15.3). */
  fields?: FieldError[];
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

/**
 * What every proxied call needs from the request it is acting for.
 *
 * A SvelteKit `RequestEvent` satisfies this structurally, so call sites pass
 * `event` rather than `event.cookies`. That substitution is the whole point:
 * the session and the caller's address travel together, and there is no way to
 * make an authenticated call while forgetting who it is for.
 *
 * **This is the second time that was forgettable.** The public auth endpoints
 * lost the address the same way and had to be fixed one call site at a time;
 * `/clicks` kept losing it, so every click in the system was recorded against
 * the `web` container. Threading a whole context costs one word per call site
 * and removes the category.
 */
export interface BffContext {
  cookies: Cookies;
  getClientAddress: () => string;
}

/**
 * Calls an API endpoint that needs no session.
 *
 * Login, registration, verification and the reset flow — the endpoints the API
 * marks `@Public()`, for callers who by definition have not proven anything
 * yet.
 */
export async function apiPublic(
  path: string,
  body: unknown,
  method = 'POST',
  clientAddress?: string,
): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...forwardedFor(clientAddress),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Tells the API whose request this is — ARCHITECTURE.md §19.5.
 *
 * **Without this every caller looks like one caller.** `web` reaches the API
 * over the internal network, so the address the API sees is the `web`
 * container's — measured, not assumed: every `/auth/*` call in the production
 * stack arrived as `172.20.0.7`. Every per-IP control on the far side then
 * counts the whole platform into a single bucket, which is worse than having no
 * control: the limit that was meant to isolate one abuser locks out everybody,
 * and the abuser is not isolated from anyone.
 *
 * The value comes from `getClientAddress()`, never from a header this process
 * read directly — and that resolves to the `X-Forwarded-For` Caddy **replaced**
 * with the address it observed on the connection (see `docker/Caddyfile`). A
 * browser that sends its own is overwritten at the boundary, so it cannot
 * choose which bucket it lands in.
 *
 * One address, not a chain: the API runs with `TRUST_PROXY_HOPS=1`, which is
 * also what the direct Caddy→api routes (`/postback/*`, `/health*`) rely on.
 */
function forwardedFor(clientAddress?: string): Record<string, string> {
  return clientAddress ? { 'x-forwarded-for': clientAddress } : {};
}

/**
 * Performs a call that establishes a session, and stores what it returns.
 *
 * The access token comes back in the body; the refresh token does **not** —
 * the API deliberately keeps it out of the response body and sets it as a
 * cookie instead (§8.1). So it is read from the `Set-Cookie` header, which
 * this process can see and a browser's JavaScript could not.
 */
export async function establishSession(
  cookies: Cookies,
  path: string,
  body: unknown,
  clientAddress?: string,
): Promise<ApiResult<UserProfile>> {
  const response = await apiPublic(path, body, 'POST', clientAddress);

  if (!response.ok) return { ok: false, failure: await readFailure(response) };

  const auth = (await response.json()) as AuthResponse;
  const refreshToken = refreshTokenFrom(response);

  if (!refreshToken) {
    /*
     * The API sets this cookie on every successful auth response, so its
     * absence means the contract changed or something between here and there
     * stripped it. Failing loudly beats storing half a session: a session with
     * no refresh token works for fifteen minutes and then logs the user out
     * for reasons no log line explains.
     */
    return {
      ok: false,
      failure: {
        status: 502,
        code: 'INTERNAL_ERROR',
        message: 'The API did not return a refresh token',
      },
    };
  }

  writeSession(cookies, { accessToken: auth.accessToken, refreshToken }, useSecureCookies());

  return { ok: true, value: auth.user };
}

/**
 * Calls the API on behalf of the session in the cookie, refreshing once if the
 * access token has expired.
 *
 * The retry is what makes a fifteen-minute access token invisible to the user
 * (§8.1). It happens **once**: a second 401 after a fresh token means the
 * session is genuinely finished — revoked, suspended, or its family reused
 * (§8.2) — and retrying that in a loop would turn one dead session into a
 * stream of requests.
 */
export async function apiAuthed(
  context: BffContext,
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<Response>> {
  const { cookies } = context;
  const clientAddress = clientAddressOf(context);

  const session = readSession(cookies);
  if (!session) return { ok: false, failure: unauthenticated() };

  const first = await send(path, init, session.accessToken, clientAddress);
  if (first.status !== 401) return { ok: true, value: first };

  const refreshed = await refreshSession(cookies, session, clientAddress);

  if (!refreshed.ok) {
    /*
     * Only a *refused* refresh ends the session.
     *
     * A refresh that could not be answered — the API throttling it (§19.5), or
     * failing closed while Redis is away — says nothing about whether the token
     * is still good. Clearing the cookie on those would turn a brief dependency
     * blip into a forced logout for everyone holding a session, and the cookie
     * is the only copy of the refresh token, so nobody gets it back.
     */
    if (refreshed.transient) {
      return { ok: false, failure: temporarilyUnavailable() };
    }

    // The refresh token is spent or revoked, so the cookie holding it is
    // worthless. Clearing it here means the next request renders a login page
    // instead of repeating this exchange.
    clearSession(cookies, useSecureCookies());
    return { ok: false, failure: unauthenticated() };
  }

  const second = await send(path, init, refreshed.session.accessToken, clientAddress);
  if (second.status === 401) {
    clearSession(cookies, useSecureCookies());
    return { ok: false, failure: unauthenticated() };
  }

  return { ok: true, value: second };
}

/** Convenience for the common case: an authenticated GET returning JSON. */
export async function apiAuthedJson<T>(context: BffContext, path: string): Promise<ApiResult<T>> {
  const result = await apiAuthed(context, path);
  if (!result.ok) return result;

  if (!result.value.ok) return { ok: false, failure: await readFailure(result.value) };

  return { ok: true, value: (await result.value.json()) as T };
}

/**
 * Ends the session at both ends.
 *
 * The API call is best effort and the cookie is cleared regardless — the same
 * reasoning the API's own logout endpoint records: a user who asked to log out
 * must end up logged out of this browser even if the server never heard about
 * it.
 */
export async function endSession(context: BffContext): Promise<void> {
  const { cookies } = context;
  const session = readSession(cookies);
  clearSession(cookies, useSecureCookies());

  if (!session) return;

  try {
    await apiPublic(
      '/auth/logout',
      { refreshToken: session.refreshToken },
      'POST',
      clientAddressOf(context),
    );
  } catch {
    // Nothing to do and nothing to tell the user: the cookie is already gone.
  }
}

/**
 * Exchanges the refresh token for a new pair and stores it.
 *
 * Distinguishes *refused* from *not answered*: a 401 means the token is
 * finished, while 429 and 5xx mean ask again later. Only the caller can act on
 * that difference, and getting it wrong costs a session that was still valid.
 */
type RefreshOutcome = { ok: true; session: Session } | { ok: false; transient: boolean };

async function refreshSession(
  cookies: Cookies,
  session: Session,
  clientAddress: string | undefined,
): Promise<RefreshOutcome> {
  const response = await apiPublic(
    '/auth/refresh',
    { refreshToken: session.refreshToken },
    'POST',
    clientAddress,
  );

  if (!response.ok) {
    return { ok: false, transient: response.status === 429 || response.status >= 500 };
  }

  const auth = (await response.json()) as AuthResponse;
  const refreshToken = refreshTokenFrom(response);

  // A 200 with no rotated cookie is our own contract broken, not a dead
  // session — treated as transient so it does not log anybody out.
  if (!refreshToken) return { ok: false, transient: true };

  const next: Session = { accessToken: auth.accessToken, refreshToken };
  writeSession(cookies, next, useSecureCookies());

  return { ok: true, session: next };
}

function send(
  path: string,
  init: RequestInit,
  accessToken: string,
  clientAddress: string | undefined,
): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      /*
       * Last, so a caller-supplied `init.headers` cannot overwrite it. The
       * proxy decides whose request this is; nothing it forwards does.
       */
      ...forwardedFor(clientAddress),
    },
  });
}

/**
 * The caller's address, from the adapter's own resolution and nowhere else.
 *
 * `getClientAddress()` reads the header named by `ADDRESS_HEADER`, which
 * production sets to `X-Forwarded-For` — the one Caddy *replaces* with the
 * address it observed. So this is the trusted representation, not a header this
 * process picked out of the request.
 *
 * It throws when that header is configured and absent, which in the production
 * topology cannot happen: nothing but Caddy can reach `web`. Caught anyway and
 * treated as "unknown", because the alternative is a 500 on every page of the
 * site if that assumption ever stops holding — and an absent header degrades to
 * exactly the behaviour that existed before any of this, while still giving a
 * caller no way to inject a value.
 */
function clientAddressOf(context: BffContext): string | undefined {
  try {
    return context.getClientAddress();
  } catch {
    return undefined;
  }
}

/**
 * Reads the rotated refresh token out of the API's `Set-Cookie` header.
 *
 * `getSetCookie()` rather than `get('set-cookie')`, because a response can
 * carry several and the plain getter joins them into one string that cannot be
 * split safely — cookie attributes contain commas of their own.
 */
export function refreshTokenFrom(response: Response): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [name, ...rest] = (pair ?? '').split('=');

    if (name?.trim() === API_REFRESH_COOKIE) {
      const value = rest.join('=').trim();
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

/**
 * Turns an API error response into something a page can render.
 *
 * The API's envelope is the contract (§15.3), but a proxy that assumes every
 * non-2xx body parses as that envelope produces a JSON parse error instead of
 * the status it was handed — most visibly when the failure is a gateway that
 * never reached the API at all.
 */
export async function readFailure(response: Response): Promise<ApiFailure> {
  try {
    const body = (await response.json()) as ApiErrorResponse;

    if (body?.error?.code) {
      return {
        status: response.status,
        code: body.error.code,
        message: body.error.message,
        ...(body.error.fields ? { fields: body.error.fields } : {}),
      };
    }
  } catch {
    // Falls through to the generic failure below.
  }

  return {
    status: response.status,
    code: 'INTERNAL_ERROR',
    message: 'The service is unavailable. Please try again.',
  };
}

function unauthenticated(): ApiFailure {
  return { status: 401, code: 'AUTH_TOKEN_INVALID', message: 'Your session has ended' };
}

/** The session is intact; the API could not answer right now. */
function temporarilyUnavailable(): ApiFailure {
  return {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is busy. Please try again in a moment.',
  };
}
