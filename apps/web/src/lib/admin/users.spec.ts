import { USER_ROLES, USER_STATUSES, type Balance } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  USER_ROLES_IN_ORDER,
  USER_STATUSES_IN_ORDER,
  balanceBuckets,
  isSelf,
  lifetimeFigures,
  roleLabel,
  shortId,
  statusChangesFor,
  statusVariant,
  statusVerb,
  userState,
} from './users';

/**
 * These decide what an operator is told before they lock somebody out of an
 * account, which is why they are a module with tests rather than expressions
 * inside a template.
 */

describe('userState', () => {
  it('gives every status in the contract a label and a meaning', () => {
    for (const status of Object.values(USER_STATUSES)) {
      const state = userState(status);

      expect(state.label).not.toBe('');
      expect(state.hint).not.toBe('');
    }
  });

  it('separates the one status that grants access from the three that do not', () => {
    // Anything other than ACTIVE fails `UsersService.isActive`, which revokes
    // every session inside the same transaction as the change.
    expect(userState('ACTIVE').tone).toBe('success');

    for (const status of ['SUSPENDED', 'BANNED', 'CLOSED'] as const) {
      expect(userState(status).tone).not.toBe('success');
    }
  });

  it('never claims a status touches the balance', () => {
    // It does not. Reversing a credit is a fraud decision with its own screen
    // and its own audit action; a status change moves nobody's points.
    for (const status of Object.values(USER_STATUSES)) {
      expect(userState(status).hint).not.toMatch(/points are (removed|reversed|taken)/i);
    }
  });

  it('degrades rather than rendering undefined for an unknown status', () => {
    expect(userState('SOMETHING_NEW' as never)).toMatchObject({ label: 'Unknown' });
  });
});

describe('statusChangesFor', () => {
  it('offers every other status, because the API permits every one of them', () => {
    // `UpdateUserStatusDto` validates with `@IsIn(STATUSES)` and nothing more.
    // An account banned in error has to be reachable again.
    expect(statusChangesFor('ACTIVE')).toEqual(['SUSPENDED', 'BANNED', 'CLOSED']);
    expect(statusChangesFor('BANNED')).toEqual(['ACTIVE', 'SUSPENDED', 'CLOSED']);
  });

  it('never offers the status the account already has', () => {
    for (const status of Object.values(USER_STATUSES)) {
      expect(statusChangesFor(status)).not.toContain(status);
      expect(statusChangesFor(status)).toHaveLength(USER_STATUSES_IN_ORDER.length - 1);
    }
  });
});

describe('statusVerb and statusVariant', () => {
  it('labels the action, not the resulting state', () => {
    // "Banned" on a button reads, at the moment of pressing, like a
    // description of the present.
    expect(statusVerb('BANNED')).toBe('Ban');
    expect(statusVerb('SUSPENDED')).toBe('Suspend');
    expect(statusVerb('ACTIVE')).toBe('Reinstate');
  });

  it('styles exactly one change as destructive', () => {
    const destructive = USER_STATUSES_IN_ORDER.filter((s) => statusVariant(s) === 'danger');

    expect(destructive).toEqual(['BANNED']);
  });
});

describe('isSelf', () => {
  it('recognises the admin acting on their own account', () => {
    // `AdminUsersService.setStatus` answers this with a 403: an admin
    // suspending themselves locks the operator out, and on a single-admin
    // deployment that needs database access to undo.
    expect(isSelf('u1', 'u1')).toBe(true);
    expect(isSelf('u1', 'u2')).toBe(false);
  });

  it('is false when the admin is unknown, so the screen never guesses', () => {
    expect(isSelf('u1', undefined)).toBe(false);
  });
});

describe('roleLabel', () => {
  it('names both roles', () => {
    for (const role of Object.values(USER_ROLES)) {
      expect(roleLabel(role)).not.toBe('');
    }
    expect(USER_ROLES_IN_ORDER).toEqual(['USER', 'ADMIN']);
  });
});

describe('shortId', () => {
  it('shortens a uuid to something a column can hold', () => {
    expect(shortId('0198f2c1-4a0e-7c3a-9f2b-5d6e7a8b9c0d')).toBe('0198f2c1…');
  });

  it('leaves anything already short alone', () => {
    expect(shortId('abc123')).toBe('abc123');
  });
});

/**
 * The balance panel — TODO T84.
 *
 * The whole risk this feature carries is that a number appears on an admin
 * screen which disagrees with the ledger. So what is worth testing is not the
 * formatting: it is that every figure shown is *read* from the accounting
 * service's answer, that the three buckets stay three, and that an absent
 * balance never becomes a zero somebody reads as evidence.
 */
const BALANCE: Balance = {
  pending: 3_000,
  available: 12_400,
  locked: 5_000,
  total: 20_400,
  lifetimeEarned: 25_400,
  lifetimeWithdrawn: 4_000,
  lifetimeReversed: 1_000,
};

describe('balanceBuckets', () => {
  it('is the three buckets ARCHITECTURE.md §9.2 names, in that order', () => {
    expect(balanceBuckets(BALANCE).map((bucket) => bucket.key)).toEqual([
      'available',
      'pending',
      'locked',
    ]);
  });

  it('reads each figure from the balance rather than deriving one', () => {
    const points = Object.fromEntries(
      balanceBuckets(BALANCE).map((bucket) => [bucket.key, bucket.points]),
    );

    expect(points).toEqual({ available: 12_400, pending: 3_000, locked: 5_000 });
  });

  it('never presents `total` as a fourth bucket', () => {
    /*
     * It is on the contract so nobody adds the three up wrongly — not so it
     * can sit beside them. An operator confirming a withdrawal against a
     * total would be confirming it against points still inside a hold period.
     */
    const keys = balanceBuckets(BALANCE).map((bucket) => bucket.key);

    expect(keys).not.toContain('total');
    expect(keys).toHaveLength(3);
  });

  it('says what each bucket means, because the three are answers to different questions', () => {
    for (const bucket of balanceBuckets(BALANCE)) {
      expect(bucket.label).not.toBe('');
      expect(bucket.hint).not.toBe('');
    }
  });

  it('leaves the points undefined when there is no balance, never zero', () => {
    // A zero balance and an unfetchable balance are different claims, and on
    // this screen the wrong one would be read as evidence about the account.
    for (const bucket of balanceBuckets(null)) {
      expect(bucket.points).toBeUndefined();
    }
  });

  it('keeps a real zero visible', () => {
    const empty = balanceBuckets({ ...BALANCE, available: 0 });

    expect(empty.find((bucket) => bucket.key === 'available')?.points).toBe(0);
  });
});

describe('lifetimeFigures', () => {
  it('reads the three lifetime totals the accounting service already exposes', () => {
    expect(
      Object.fromEntries(lifetimeFigures(BALANCE).map((f) => [f.key, f.points])),
    ).toEqual({ lifetimeEarned: 25_400, lifetimeWithdrawn: 4_000, lifetimeReversed: 1_000 });
  });

  it('is unknown rather than zero when the balance could not be loaded', () => {
    for (const figure of lifetimeFigures(null)) {
      expect(figure.points).toBeUndefined();
    }
  });
});
