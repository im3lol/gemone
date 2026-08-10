import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import type { Env } from '../../core/config/env.schema';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import {
  buildRefreshCookieOptions,
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
} from './refresh-cookie';

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    COOKIE_SECURE: true,
    ...overrides,
  } as Env;
}

const EXPIRES = new Date('2030-01-01T00:00:00.000Z');

describe('refresh cookie', () => {
  describe('attributes', () => {
    it('is httpOnly — the property the whole design rests on', () => {
      // If JavaScript can read this cookie, an XSS becomes a stolen
      // long-lived credential rather than a bounded incident.
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).httpOnly).toBe(true);
    });

    it('is Secure when configured, so it never crosses plaintext', () => {
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).secure).toBe(true);
    });

    it('allows Secure to be disabled for local development only', () => {
      // Production is prevented from doing this by the environment schema,
      // not by this function.
      expect(
        buildRefreshCookieOptions(envWith({ COOKIE_SECURE: false }), EXPIRES).secure,
      ).toBe(false);
    });

    it('uses SameSite=Lax, not Strict', () => {
      // Strict drops the cookie on cross-site navigation, so a user following
      // a link from an email arrives logged out. Lax still withholds it on
      // cross-site POST, which is the CSRF vector that matters.
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).sameSite).toBe('lax');
    });

    it('is scoped to /auth, so it is not sent with every request', () => {
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).path).toBe(REFRESH_COOKIE_PATH);
    });

    it('expires with the refresh token', () => {
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).expires).toBe(EXPIRES);
    });

    it('omits the domain unless one is configured', () => {
      expect(buildRefreshCookieOptions(envWith(), EXPIRES).domain).toBeUndefined();
      expect(
        buildRefreshCookieOptions(envWith({ COOKIE_DOMAIN: 'gemone.io' }), EXPIRES).domain,
      ).toBe('gemone.io');
    });
  });

  describe('setting and clearing', () => {
    it('sets the token under the expected name', () => {
      const calls: unknown[][] = [];
      const response = { cookie: (...args: unknown[]) => calls.push(args) } as unknown as Response;

      setRefreshCookie(response, envWith(), 'the-token', EXPIRES);

      expect(calls[0]?.[0]).toBe(REFRESH_COOKIE_NAME);
      expect(calls[0]?.[1]).toBe('the-token');
    });

    it('clears using the same path it was set with', () => {
      const calls: unknown[][] = [];
      const response = {
        clearCookie: (...args: unknown[]) => calls.push(args),
      } as unknown as Response;

      clearRefreshCookie(response, envWith());

      // A clear with a different path silently does nothing, leaving the
      // browser holding a token the server has already revoked.
      const options = calls[0]?.[1] as { path?: string; httpOnly?: boolean };
      expect(calls[0]?.[0]).toBe(REFRESH_COOKIE_NAME);
      expect(options.path).toBe(REFRESH_COOKIE_PATH);
      expect(options.httpOnly).toBe(true);
    });
  });

  describe('reading', () => {
    const request = (cookies: Record<string, unknown> = {}) =>
      ({ cookies }) as unknown as Request;

    it('reads the cookie', () => {
      expect(readRefreshToken(request({ [REFRESH_COOKIE_NAME]: 'from-cookie' }))).toBe(
        'from-cookie',
      );
    });

    it('falls back to the body for non-browser clients', () => {
      expect(readRefreshToken(request(), { refreshToken: 'from-body' })).toBe('from-body');
    });

    it('prefers the cookie when both are present', () => {
      expect(
        readRefreshToken(request({ [REFRESH_COOKIE_NAME]: 'from-cookie' }), {
          refreshToken: 'from-body',
        }),
      ).toBe('from-cookie');
    });

    it('returns undefined when there is nothing to read', () => {
      expect(readRefreshToken(request())).toBeUndefined();
      expect(readRefreshToken(request(), {})).toBeUndefined();
      expect(readRefreshToken({} as Request)).toBeUndefined();
    });

    it('ignores empty and non-string values rather than passing them on', () => {
      expect(readRefreshToken(request({ [REFRESH_COOKIE_NAME]: '' }))).toBeUndefined();
      expect(readRefreshToken(request({ [REFRESH_COOKIE_NAME]: 42 }))).toBeUndefined();
      expect(readRefreshToken(request(), { refreshToken: null })).toBeUndefined();
    });
  });
});
