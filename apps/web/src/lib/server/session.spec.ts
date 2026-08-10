import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE, clearSession, readSession, writeSession, __testing } from './session';

/**
 * A stand-in for SvelteKit's `Cookies`, recording what was set.
 *
 * The options are what matter here — `httpOnly` is the whole security claim of
 * §6.1 — so they are captured rather than discarded.
 */
function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const calls: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  const deletedOptions: Record<string, unknown>[] = [];

  const cookies = {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, value);
      calls.push({ name, value, options });
    },
    delete: (name: string, options: Record<string, unknown>) => {
      jar.delete(name);
      deleted.push(name);
      deletedOptions.push(options);
    },
  } as unknown as Cookies;

  return { cookies, calls, deleted, deletedOptions, jar };
}

const session = { accessToken: 'header.payload.signature', refreshToken: 'opaque-refresh' };

describe('session cookie', () => {
  it('round-trips the token pair', () => {
    const { cookies } = fakeCookies();

    writeSession(cookies, session, false);

    expect(readSession(cookies)).toEqual(session);
  });

  it('is httpOnly, lax and scoped to the whole site', () => {
    /*
     * The reason `web` exists at all (§6.1): a session the browser's
     * JavaScript can read is a session an XSS bug can steal. If this ever
     * relaxes, the proxy has stopped buying anything.
     */
    const { cookies, calls } = fakeCookies();

    writeSession(cookies, session, true);

    expect(calls[0]!.name).toBe(SESSION_COOKIE);
    expect(calls[0]!.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: __testing.MAX_AGE_SECONDS,
    });
  });

  it('does not mark the cookie Secure outside production', () => {
    // Otherwise nobody can log in over plain HTTP on localhost, and the first
    // thing a new developer meets is a login form that silently does nothing.
    const { cookies, calls } = fakeCookies();

    writeSession(cookies, session, false);

    expect(calls[0]!.options.secure).toBe(false);
  });

  it('never writes the tokens where a reader could mistake them for opaque', () => {
    // Base64url is an encoding, not a protection — this test exists to state
    // that plainly, so nobody later assumes the cookie is sealed.
    const { cookies, calls } = fakeCookies();

    writeSession(cookies, session, false);

    const decoded = Buffer.from(calls[0]!.value, 'base64url').toString('utf8');
    expect(decoded).toContain('opaque-refresh');
  });

  it('reads as logged out when there is no cookie', () => {
    expect(readSession(fakeCookies().cookies)).toBeNull();
  });

  it('reads as logged out when the cookie is not decodable', () => {
    /*
     * A truncated or hand-edited cookie means "not logged in", which resolves
     * by logging in again. Throwing would make the login page that fixes it
     * the page that cannot render.
     */
    const { cookies } = fakeCookies({ [SESSION_COOKIE]: 'not-base64-json!!' });

    expect(readSession(cookies)).toBeNull();
  });

  it('reads as logged out when the payload is the wrong shape', () => {
    const encoded = Buffer.from(JSON.stringify({ accessToken: 'only-one' })).toString('base64url');
    const { cookies } = fakeCookies({ [SESSION_COOKIE]: encoded });

    expect(readSession(cookies)).toBeNull();
  });

  it('clears by path, so the browser actually drops it', () => {
    // A delete without the path the cookie was set with is a no-op the browser
    // ignores, and a logout that leaves the cookie in place is not a logout.
    const { cookies, deleted } = fakeCookies();
    writeSession(cookies, session, false);

    clearSession(cookies, false);

    expect(deleted).toEqual([SESSION_COOKIE]);
    expect(readSession(cookies)).toBeNull();
  });

  it('clears with the same Secure flag it was written with', () => {
    /*
     * A browser on plain HTTP ignores a `Set-Cookie` carrying `Secure`, so a
     * deletion that adds the flag the write omitted does nothing at all — and
     * "log out" that leaves you logged in is the worst possible version of
     * this bug, because the page says it worked.
     */
    const { cookies, deletedOptions } = fakeCookies();

    clearSession(cookies, false);

    expect(deletedOptions[0]).toMatchObject({ path: '/', secure: false });
  });
});
