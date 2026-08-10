import { Reflector } from '@nestjs/core';
import { USER_ROLES, type UserRole } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../core/errors/app-error';
import type { AuthenticatedUser } from './authenticated-user';
import { RolesGuard } from './roles.guard';
import { __testing as jwtGuardTesting } from './jwt-auth.guard';

function contextFor(user?: AuthenticatedUser) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

function guardRequiring(roles: UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: () => roles,
  } as unknown as Reflector;

  return new RolesGuard(reflector);
}

const activeUser = (role: UserRole): AuthenticatedUser => ({
  id: 'u-1',
  email: 'a@b.co',
  role,
  status: 'ACTIVE',
});

describe('RolesGuard', () => {
  it('allows a route that declares no roles', () => {
    expect(guardRequiring(undefined).canActivate(contextFor(activeUser('USER')))).toBe(true);
  });

  it('allows a route with an empty role list', () => {
    expect(guardRequiring([]).canActivate(contextFor(activeUser('USER')))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    expect(
      guardRequiring([USER_ROLES.ADMIN]).canActivate(contextFor(activeUser('ADMIN'))),
    ).toBe(true);
  });

  it('denies a user without the required role', () => {
    expect(() =>
      guardRequiring([USER_ROLES.ADMIN]).canActivate(contextFor(activeUser('USER'))),
    ).toThrow(DomainError);
  });

  it('denies with 403, not 401 — the caller is known, just not permitted', () => {
    try {
      guardRequiring([USER_ROLES.ADMIN]).canActivate(contextFor(activeUser('USER')));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DomainError).httpStatus).toBe(403);
    }
  });

  it('denies when no principal is present, rather than defaulting to allow', () => {
    // Reachable only by combining @Roles() with @Public(), which is a
    // contradiction. Denying is the safe reading of a contradictory
    // declaration.
    expect(() => guardRequiring([USER_ROLES.ADMIN]).canActivate(contextFor(undefined))).toThrow(
      DomainError,
    );
  });

  it('accepts any one of several permitted roles', () => {
    const guard = guardRequiring([USER_ROLES.USER, USER_ROLES.ADMIN]);

    expect(guard.canActivate(contextFor(activeUser('USER')))).toBe(true);
    expect(guard.canActivate(contextFor(activeUser('ADMIN')))).toBe(true);
  });
});

describe('bearer token extraction', () => {
  const extract = jwtGuardTesting.extractBearerToken;
  const req = (authorization?: unknown) => ({ headers: { authorization } }) as never;

  it('reads a well-formed header', () => {
    expect(extract(req('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
  });

  it('is case-insensitive about the scheme, as RFC 7235 requires', () => {
    expect(extract(req('bearer abc'))).toBe('abc');
    expect(extract(req('BEARER abc'))).toBe('abc');
  });

  it('rejects other schemes rather than treating them as bearer tokens', () => {
    expect(extract(req('Basic dXNlcjpwYXNz'))).toBeNull();
    expect(extract(req('abc.def.ghi'))).toBeNull();
  });

  it('returns null for a missing or empty header', () => {
    expect(extract(req(undefined))).toBeNull();
    expect(extract(req(''))).toBeNull();
    expect(extract(req('Bearer'))).toBeNull();
    expect(extract(req('Bearer '))).toBeNull();
  });

  it('ignores a non-string header value', () => {
    expect(extract(req(['Bearer abc']))).toBeNull();
  });
});
