import type { CookieOptions, Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';

/**
 * The refresh-token cookie — ARCHITECTURE.md §6.1, §8.1.
 *
 * The refresh token is the only credential that reaches the browser, and it
 * reaches it as an httpOnly cookie that JavaScript cannot read. That removes
 * the entire class of token-theft-via-XSS: an injected script can still make
 * requests, but it cannot exfiltrate a long-lived credential.
 *
 * The access token is never a cookie. It goes in the response body for the
 * BFF to hold server-side and send as a bearer header.
 *
 * NOTE ON THE BFF: ARCHITECTURE.md §6.1 has SvelteKit holding the session and
 * proxying to the API. That app does not exist yet, so today the API sets this
 * cookie itself. The contract is identical either way — the BFF will forward
 * the cookie rather than mint its own — so nothing here changes when it lands.
 */
export function buildRefreshCookieOptions(env: Env, expiresAt: Date): CookieOptions {
  return {
    // JavaScript cannot read it. The entire point.
    httpOnly: true,

    // Never sent over plaintext. Enforced as true in production by the
    // environment schema, so this cannot be misconfigured silently.
    secure: env.COOKIE_SECURE,

    /*
     * Lax, not Strict.
     *
     * Strict would drop the cookie on any cross-site navigation into the app —
     * a user following a link from an email would arrive logged out. Lax
     * still withholds it on cross-site POST, which is the CSRF vector that
     * matters, and this cookie is only ever read by /auth endpoints.
     */
    sameSite: 'lax',

    // Scoped so it accompanies only auth requests. A cookie sent with every
    // request is a cookie exposed on every request.
    path: REFRESH_COOKIE_PATH,

    expires: expiresAt,

    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setRefreshCookie(
  response: Response,
  env: Env,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, buildRefreshCookieOptions(env, expiresAt));
}

/**
 * Clears the cookie.
 *
 * The attributes must match those it was set with — path in particular. A
 * clear with a different path silently does nothing, leaving the browser
 * holding a token the server has already revoked.
 */
export function clearRefreshCookie(response: Response, env: Env): void {
  const { expires: _expires, ...options } = buildRefreshCookieOptions(env, new Date(0));
  response.clearCookie(REFRESH_COOKIE_NAME, options);
}

/**
 * Reads the refresh token.
 *
 * The cookie is the supported transport. The body is accepted as a fallback
 * for non-browser clients (the future mobile app, §21) which have no cookie
 * jar; the cookie wins when both are present.
 */
export function readRefreshToken(
  request: Request & { cookies?: Record<string, unknown> },
  body?: { refreshToken?: unknown },
): string | undefined {
  const fromCookie = request.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  const fromBody = body?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;

  return undefined;
}
