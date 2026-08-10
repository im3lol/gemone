import { describe, expect, it } from 'vitest';

import { UsersService } from './users.service';
import type { User } from '../../generated/prisma/client';

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: '0192f0a0-0000-7000-8000-000000000000',
    email: 'user@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
    role: 'USER',
    status: 'ACTIVE',
    emailVerifiedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    registrationIp: '203.0.113.10',
    registrationCountry: 'GB',
    locale: 'en',
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    updatedAt: new Date('2026-01-02T12:00:00.000Z'),
    ...overrides,
  } as User;
}

describe('UsersService', () => {
  describe('email normalisation', () => {
    it('lowercases, so casing cannot create a second account', () => {
      expect(UsersService.normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
    });

    it('trims, so a stray space cannot create a second account', () => {
      expect(UsersService.normalizeEmail('  alice@example.com  ')).toBe(
        'alice@example.com',
      );
    });

    it('is idempotent', () => {
      const once = UsersService.normalizeEmail(' Alice@Example.com ');

      expect(UsersService.normalizeEmail(once)).toBe(once);
    });
  });

  describe('toProfile', () => {
    it('never exposes the password hash', () => {
      const profile = UsersService.toProfile(userRow());

      expect(JSON.stringify(profile)).not.toContain('argon2');
      expect('passwordHash' in profile).toBe(false);
    });

    it('never exposes the TOTP secret or the registration IP', () => {
      const profile = UsersService.toProfile(
        userRow({ totpSecret: 'JBSWY3DPEHPK3PXP' }),
      );
      const serialised = JSON.stringify(profile);

      expect(serialised).not.toContain('JBSWY3DPEHPK3PXP');
      expect(serialised).not.toContain('203.0.113.10');
    });

    it('returns exactly the documented public fields and nothing more', () => {
      // An allowlist, not an omission list: a column added to the table must
      // be deliberately added here to become public (§19.3).
      expect(Object.keys(UsersService.toProfile(userRow())).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'locale',
        'role',
        'status',
      ]);
    });

    it('serialises timestamps as ISO-8601 UTC', () => {
      expect(UsersService.toProfile(userRow()).createdAt).toBe(
        '2026-01-01T12:00:00.000Z',
      );
    });
  });

  describe('isActive', () => {
    it('accepts only ACTIVE', () => {
      expect(UsersService.isActive(userRow({ status: 'ACTIVE' }))).toBe(true);
    });

    it('rejects every other status', () => {
      // Suspended, banned and closed accounts must not hold a session, and
      // adding a status later must not accidentally grant access.
      expect(UsersService.isActive(userRow({ status: 'SUSPENDED' }))).toBe(false);
      expect(UsersService.isActive(userRow({ status: 'BANNED' }))).toBe(false);
      expect(UsersService.isActive(userRow({ status: 'CLOSED' }))).toBe(false);
    });
  });
});
