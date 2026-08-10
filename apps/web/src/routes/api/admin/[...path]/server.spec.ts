import type { Cookies } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeSession } from '$lib/server/session';
import { DELETE, GET, POST } from './+server';

/**
 * The admin proxy — the only route from the public origin to `/admin/*`.
 *
 * What matters here is not that it forwards, but *what it refuses to do*: it
 * never decides who is an admin, and it can never be aimed at an endpoint
 * outside `/admin/`.
 */
function fakeCookies(session?: { accessToken: string; refreshToken: string }) {
  const jar = new Map<string, string>();

  const cookies = {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  } as unknown as Cookies;

  if (session) writeSession(cookies, session, false);

  return cookies;
}

const SESSION = { accessToken: 'the-access-token', refreshToken: 'the-refresh-token' };

const fetchMock = vi.fn();

/** Invokes a handler with the shape SvelteKit passes it. */
function call(
  handler: typeof GET,
  {
    path,
    method = 'GET',
    search = '',
    body,
    cookies = fakeCookies(SESSION),
  }: {
    path: string;
    method?: string;
    search?: string;
    body?: string;
    cookies?: Cookies;
  },
) {
  const url = new URL(`https://gemone.example/api/admin/${path}${search}`);
  const request = new Request(url, {
    method,
    ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}),
  });

  return handler({ params: { path }, request, url, cookies } as never);
}

beforeEach(() => {
  process.env.API_URL = 'http://api:3000';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the admin API proxy', () => {
  it('forwards a GET under /admin with the session bearer token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await call(GET, { path: 'providers', search: '?limit=10' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/admin/providers?limit=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer the-access-token' }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it('forwards a POST body and the status the API answered with', async () => {
    // Creating a provider is the call that was unreachable in production, and
    // its 201 has to arrive intact for a caller to learn the new id.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'p1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await call(POST, {
      path: 'providers',
      method: 'POST',
      body: JSON.stringify({ slug: 'mock' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/admin/providers',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ slug: 'mock' }) }),
    );
    expect(response.status).toBe(201);
  });

  it('passes a 403 through instead of deciding who is an admin', async () => {
    /*
     * The authorization boundary, asserted as an absence: this file contains no
     * role check, so a signed-in non-admin reaches the API and is refused
     * *there* by `@Roles(ADMIN)`. If `web` ever answered this itself, the API
     * would have a second, weaker gatekeeper in front of it.
     */
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'AUTH_FORBIDDEN', message: 'Forbidden' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await call(GET, { path: 'configuration' });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUTH_FORBIDDEN' } });
  });

  it('cannot be aimed outside /admin', async () => {
    /*
     * `fetch` would resolve `/admin/../auth/login` to `/auth/login` before the
     * request left this process — which would make this a proxy onto every
     * endpoint in the API, authenticated with the caller's own session.
     */
    const response = await call(POST, { path: '../auth/login', method: 'POST', body: '{}' });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty path rather than proxying /admin itself', async () => {
    const response = await call(GET, { path: '' });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 without calling the API when there is no session', async () => {
    const response = await call(GET, { path: 'providers', cookies: fakeCookies() });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not replay the API’s Set-Cookie to the browser', async () => {
    /*
     * The refresh cookie is the credential §6.1 keeps server-side. Forwarding
     * response headers wholesale would hand it to the browser, which is the one
     * thing the BFF exists to prevent.
     */
    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'gemone_rt=leaked; Path=/auth; HttpOnly',
        },
      }),
    );

    const response = await call(GET, { path: 'providers' });

    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('returns a bodyless 204 rather than throwing on one', async () => {
    // A `Response` with a body and a 204 status throws, which would turn every
    // successful delete into a 500.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await call(DELETE, { path: 'providers/p1', method: 'DELETE' });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
  });
});
