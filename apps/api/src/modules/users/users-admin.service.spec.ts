import { describe, expect, it } from 'vitest';
import type { UserStatus } from '@gemone/contracts';

import { UsersService, __testing } from './users.service';
import type { User } from '../../generated/prisma/client';

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: '0192f0a0-0000-7000-8000-000000000000',
    email: 'user@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
    role: 'USER',
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-02-01T00:00:00.000Z'),
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabledAt: null,
    registrationIp: '203.0.113.10',
    registrationCountry: 'GB',
    locale: 'en',
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    updatedAt: new Date('2026-01-02T12:00:00.000Z'),
    ...overrides,
  } as User;
}

const ALL: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'BANNED', 'CLOSED'];

describe('user status transitions', () => {
  it('permits moving between any two live statuses', () => {
    expect(UsersService.canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(UsersService.canTransition('ACTIVE', 'BANNED')).toBe(true);
    expect(UsersService.canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(UsersService.canTransition('BANNED', 'ACTIVE')).toBe(true);
    expect(UsersService.canTransition('SUSPENDED', 'BANNED')).toBe(true);
  });

  it('allows reinstatement, because admins ban the wrong account sometimes', () => {
    expect(UsersService.canTransition('BANNED', 'ACTIVE')).toBe(true);
  });

  it('treats CLOSED as terminal', () => {
    // A user whose personal data was anonymised on closure (DATABASE.md §7.3)
    // cannot be reactivated: the data needed to reactivate them is gone.
    for (const target of ALL) {
      expect(UsersService.canTransition('CLOSED', target)).toBe(false);
    }
  });

  it('rejects a transition to the same status', () => {
    for (const status of ALL) {
      expect(UsersService.canTransition(status, status)).toBe(false);
    }
  });
});

describe('admin list pagination', () => {
  const { clampLimit, DEFAULT_LIMIT, MAX_LIMIT } = __testing;

  it('defaults when no limit is given', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('caps an oversized request', () => {
    // An unbounded limit is a table scan any admin can request by accident.
    expect(clampLimit(100_000)).toBe(MAX_LIMIT);
  });

  it('raises a nonsensical request to at least one row', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('honours a reasonable request', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(MAX_LIMIT)).toBe(MAX_LIMIT);
  });
});

describe('toAdminSummary', () => {
  it('adds the operational fields an admin needs', () => {
    const summary = UsersService.toAdminSummary(userRow(), 3);

    expect(summary.activeSessionCount).toBe(3);
    expect(summary.emailVerifiedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(summary.registrationCountry).toBe('GB');
    expect(summary.updatedAt).toBe('2026-01-02T12:00:00.000Z');
  });

  it('still refuses to expose secrets — "admin" is not a reason to serialise them', () => {
    const serialised = JSON.stringify(UsersService.toAdminSummary(userRow(), 0));

    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain('JBSWY3DPEHPK3PXP');
    expect(serialised).not.toContain('203.0.113.10');
  });

  it('returns exactly the documented fields', () => {
    expect(Object.keys(UsersService.toAdminSummary(userRow(), 0)).sort()).toEqual([
      'activeSessionCount',
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
      'locale',
      'registrationCountry',
      'role',
      'status',
      'updatedAt',
    ]);
  });

  it('reports a never-verified email as null rather than omitting it', () => {
    expect(UsersService.toAdminSummary(userRow({ emailVerifiedAt: null }), 0).emailVerifiedAt).toBe(
      null,
    );
  });
});
