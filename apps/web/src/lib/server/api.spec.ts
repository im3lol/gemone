import type { Cookies } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiAuthed, apiPublic, establishSession, refreshTokenFrom } from './api';
import { readSession, writeSession } from './session';

function fakeCookies() {
  const jar = new Map<string, string>();

  const cookies = {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  } as unknown as Cookies;

  return cookies;
}

/** An API response carrying a rotated refresh cookie, as the real one does. */
function authResponse(accessToken: string, refreshToken: string | null, status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('set-cookie', 'other=irrelevant; Path=/');
  if (refreshToken !== null) {
    headers.append(
      'set-cookie',
      `gemone_rt=${encodeURIComponent(refreshToken)}; Path=/auth; HttpOnly; SameSite=Lax`,
    );
  }

  return new Response(
    JSON.stringify({
      accessToken,
      expiresIn: 900,
      tokenType: 'Bearer',
      user: { id: 'u1', email: 'a@b.test', role: 'USER', status: 'ACTIVE', locale: 'en', createdAt: 'x' },
    }),
    { status, headers },
  );
}

/**
 * A caller with both halves of the context: a session and an address.
 *
 * `apiAuthed` takes these together on purpose — the production bug this file
 * pins is a call that had the session and lost the address.
 */
function fakeContext(cookies: Cookies = fakeCookies(), address = '203.0.113.1') {
  return { cookies, getClientAddress: () => address };
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.API_URL = 'http://api:3000';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshTokenFrom', () => {
  it('finds the API refresh cookie among several', () => {
    /*
     * `getSetCookie()` rather than the joined header: cookie attributes carry
     * commas of their own (`Expires=Wed, 09 Jun 2027`), so splitting the
     * combined value is how a parser loses tokens intermittently.
     */
    expect(refreshTokenFrom(authResponse('access', 'the-refresh'))).toBe('the-refresh');
  });

  it('URL-decodes the value', () => {
    expect(refreshTokenFrom(authResponse('access', 'a+b/c=='))).toBe('a+b/c==');
  });

  it('returns null when the API set no refresh cookie', () => {
    expect(refreshTokenFrom(authResponse('access', null))).toBeNull();
  });
});

describe('forwarding the caller’s address', () => {
  it('tells the API whose request it is', async () => {
    /*
     * Measured, not theorised: before this, every `/auth/*` call in the
     * production stack reached the API as `172.20.0.7` — the `web` container.
     * Every per-IP control on the far side then counts the whole platform into
     * one bucket, so the limit meant to isolate an abuser locks out everyone
     * and isolates nobody.
     */
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await apiPublic('/auth/forgot-password', { email: 'a@b.test' }, 'POST', '203.0.113.7');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.7');
  });

  it('sends no header at all when there is no address to send', async () => {
    // Rather than an empty one, which the API would have to decide how to read.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await apiPublic('/auth/logout', {});

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBeUndefined();
  });

  it('carries it through an authenticated call', async () => {
    /*
     * `/clicks` is why this matters most. The API reads `request.ip` and stores
     * it on the click row, and that value keys the per-IP click ceiling, the
     * shared-IP fraud rule and the IP conversion-velocity rule. Without the
     * header every click in the system is recorded against the `web`
     * container — one address for the whole platform — and once eight accounts
     * have converted from "the same IP", every later conversion is held for
     * review.
     */
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'access-1', refreshToken: 'refresh-1' }, false);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiAuthed(fakeContext(cookies, '203.0.113.9'), '/clicks', {
      method: 'POST',
      body: '{"offerId":"o1"}',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.9');
  });

  it('does not let a caller-supplied header override it', async () => {
    // The proxy decides whose request this is. Anything travelling in `init`
    // came from further out and is exactly what must not win.
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'access-1', refreshToken: 'refresh-1' }, false);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiAuthed(fakeContext(cookies, '203.0.113.9'), '/clicks', {
      method: 'POST',
      body: '{}',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.9');
  });

  it('carries it through the refresh exchange and the retry', async () => {
    // Otherwise a click that happens to arrive on an expired access token is
    // attributed differently from one that does not.
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'refresh-1' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(authResponse('access-2', 'refresh-2'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await apiAuthed(fakeContext(cookies, '203.0.113.9'), '/clicks');

    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.9');
    }
  });

  it('sends no address rather than failing when the adapter cannot resolve one', async () => {
    /*
     * `getClientAddress()` throws when `ADDRESS_HEADER` is configured and the
     * header is absent — which in production means something other than Caddy
     * reached `web`, and cannot happen while the API and web hold no published
     * ports. Degrading to "unknown" beats a 500 on every page, and an absent
     * header still gives a caller no way to inject one.
     */
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'access-1', refreshToken: 'refresh-1' }, false);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    const throwing = {
      cookies,
      getClientAddress: () => {
        throw new Error('ADDRESS_HEADER is configured but absent from request');
      },
    };

    const result = await apiAuthed(throwing, '/clicks');

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBeUndefined();
  });

  it('carries it through the call that establishes a session', async () => {
    // Login's per-IP failure counter (§8.3) is keyed on it too.
    fetchMock.mockResolvedValue(authResponse('access', 'refresh'));

    await establishSession(fakeCookies(), '/auth/login', {}, '203.0.113.8');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-forwarded-for']).toBe('203.0.113.8');
  });
});

describe('establishSession', () => {
  it('stores the access token from the body and the refresh token from the header', async () => {
    // The API keeps the refresh token out of the response body on purpose
    // (§8.1), so reading it from the header is not a shortcut — it is the only
    // place it appears.
    const cookies = fakeCookies();
    fetchMock.mockResolvedValueOnce(authResponse('access-1', 'refresh-1'));

    const result = await establishSession(cookies, '/auth/login', {});

    expect(result.ok).toBe(true);
    expect(readSession(cookies)).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('refuses to store half a session when the refresh cookie is missing', async () => {
    /*
     * A session with no refresh token works for fifteen minutes and then logs
     * the user out for reasons no log line explains. Failing here makes that a
     * visible error instead.
     */
    const cookies = fakeCookies();
    fetchMock.mockResolvedValueOnce(authResponse('access-1', null));

    const result = await establishSession(cookies, '/auth/login', {});

    expect(result.ok).toBe(false);
    expect(readSession(cookies)).toBeNull();
  });

  it('returns the API failure rather than inventing one', async () => {
    const cookies = fakeCookies();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password', correlationId: 'c' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await establishSession(cookies, '/auth/login', {});

    expect(result).toEqual({
      ok: false,
      failure: { status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
  });
});

describe('apiAuthed', () => {
  it('sends the access token as a bearer and does not refresh when it works', async () => {
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'access-1', refreshToken: 'refresh-1' }, false);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api:3000/users/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    /*
     * The whole reason a fifteen-minute access token is usable: the user never
     * sees it expire. This is the exchange §8.1 assumes somebody performs.
     */
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'refresh-1' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(authResponse('access-2', 'refresh-2'))
      .mockResolvedValueOnce(new Response('{"id":"u1"}', { status: 200 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The rotated pair is stored, or the next request replays a spent token —
    // which §8.2 treats as theft and answers by revoking the whole family.
    expect(readSession(cookies)).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2' });

    const retry = fetchMock.mock.calls[2]!;
    expect((retry[1].headers as Record<string, string>).authorization).toBe('Bearer access-2');
  });

  it('gives up and clears the cookie when the refresh is refused', async () => {
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'spent' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(false);
    expect(readSession(cookies)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the session when the refresh is throttled rather than refused', async () => {
    /*
     * A 429 says "ask again later", not "this token is dead" — and the API now
     * rate-limits `/auth/refresh` (§19.5) and fails closed while Redis is away.
     * Clearing the cookie on those would turn a brief blip into a forced logout
     * for every signed-in user, with no way back: the cookie is the only copy
     * of the refresh token.
     */
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'still-good' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(false);
    expect(readSession(cookies)?.refreshToken).toBe('still-good');
  });

  it('keeps the session when the refresh cannot be answered at all', async () => {
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'still-good' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(false);
    expect(readSession(cookies)?.refreshToken).toBe('still-good');
  });

  it('retries exactly once, even if the fresh token is also refused', async () => {
    /*
     * A second 401 after a successful refresh means the session is genuinely
     * finished — revoked, suspended, or its family reused. Looping on that
     * turns one dead session into a stream of requests against the API.
     */
    const cookies = fakeCookies();
    writeSession(cookies, { accessToken: 'expired', refreshToken: 'refresh-1' }, false);

    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(authResponse('access-2', 'refresh-2'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const result = await apiAuthed(fakeContext(cookies), '/users/me');

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readSession(cookies)).toBeNull();
  });

  it('does not call the API at all without a session', async () => {
    const result = await apiAuthed(fakeContext(), '/users/me');

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
