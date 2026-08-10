import type { Cookies } from '@sveltejs/kit';

/**
 * The browser's session — ARCHITECTURE.md §6.1, §23 open question 4.
 *
 * ## What the browser holds
 *
 * One `httpOnly` cookie containing the token pair, and nothing else. §6.1's
 * whole argument is that the browser's JavaScript must never be able to read a
 * token, because that is the difference between an XSS bug and an account
 * takeover. `httpOnly` is what enforces it; the SvelteKit server reads the
 * cookie, and the browser only carries it.
 *
 * ## Why it is not signed
 *
 * §23 records the starting position as "signed cookies holding the token
 * pair". The pair is here; the signature is deliberately not, because it would
 * protect nothing that is not already protected. **Both tokens authenticate
 * themselves at the API**: the access token is a JWT the API verifies by
 * signature (§8.1), and the refresh token is matched against a hash in
 * `refresh_tokens` (§8.2). A tampered cookie therefore produces a 401 rather
 * than a forged session, and an attacker who can write this cookie can only
 * put tokens in it that they already hold.
 *
 * A second secret, a second place to rotate it, and an HMAC on every request
 * for that is what P6 exists to refuse. If `web` ever stores something it
 * *does* trust — a role, a flag, anything it does not re-verify — this comment
 * stops being true and the signature has to arrive with that field.
 */
export interface Session {
  /** Short-lived JWT. Sent to the API as a bearer token. */
  accessToken: string;

  /** Opaque, long-lived, rotated on every use (§8.2). */
  refreshToken: string;
}

export const SESSION_COOKIE = 'gemone_session';

/**
 * Thirty days — the refresh token's own lifetime.
 *
 * Deliberately not the access token's fifteen minutes: this cookie outlives
 * the access token on purpose, because holding the refresh token is what lets
 * the server mint a new one without sending the user back to a login form.
 */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readSession(cookies: Cookies): Session | null {
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Session).accessToken !== 'string' ||
      typeof (parsed as Session).refreshToken !== 'string'
    ) {
      return null;
    }

    return { accessToken: (parsed as Session).accessToken, refreshToken: (parsed as Session).refreshToken };
  } catch {
    /*
     * A cookie this process cannot parse is not an error worth showing anyone.
     * It means a truncated value, a stale format, or someone editing it by
     * hand — all of which mean "not logged in", and all of which resolve by
     * logging in again. Throwing here would turn a malformed cookie into a
     * 500 on every page, including the login page that would fix it.
     */
    return null;
  }
}

export function writeSession(cookies: Cookies, session: Session, secure: boolean): void {
  cookies.set(SESSION_COOKIE, encode(session), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Removes the session cookie.
 *
 * `secure` is passed rather than left to SvelteKit's default, which is `true`
 * for every host except `localhost`. That default emits `Secure` on the
 * deletion cookie while `writeSession` — asked for `false` in development —
 * omitted it on the way in, and a browser on plain HTTP **ignores a `Set-Cookie`
 * carrying `Secure`**: the deletion silently does nothing and the user stays
 * logged in after clicking log out. Only on `http://127.0.0.1`, only in
 * development, and only until someone spends an afternoon on it.
 */
export function clearSession(cookies: Cookies, secure: boolean): void {
  cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

/** Base64url of the JSON pair. An encoding, not a protection — see above. */
function encode(session: Session): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

export const __testing = { encode, MAX_AGE_SECONDS };
