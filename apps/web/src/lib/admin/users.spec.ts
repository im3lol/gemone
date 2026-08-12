import { USER_ROLES, USER_STATUSES, type Balance } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  USER_ROLES_IN_ORDER,
  USER_STATUSES_IN_ORDER,
  balanceBuckets,
  isSelf,
  lifetimeFigures,
  roleChangeFor,
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

/**
 * Appointing and removing administrators — TODO T85.
 *
 * The words on a control that grants somebody every payout, every provider and
 * every configuration value. What is worth testing is that the button offers
 * the role the account does *not* hold, that a demotion is not described as a
 * suspension, and that an unrecognised role produces no button at all.
 */
describe('roleChangeFor', () => {
  it('offers the other role, never the one the account already holds', () => {
    // A control whose success is indistinguishable from doing nothing — the
    // same reason `statusChangesFor` omits the current status.
    expect(roleChangeFor('USER')?.to).toBe('ADMIN');
    expect(roleChangeFor('ADMIN')?.to).toBe('USER');
  });

  it('labels each direction with the act, and says what it does', () => {
    for (const role of USER_ROLES_IN_ORDER) {
      const change = roleChangeFor(role);

      expect(change?.verb).not.toBe('');
      expect(change?.hint).not.toBe('');
    }
  });

  it('styles only the removal as destructive', () => {
    expect(roleChangeFor('USER')?.variant).toBe('primary');
    expect(roleChangeFor('ADMIN')?.variant).toBe('danger');
  });

  it('says a demotion is not a suspension, because the two are confused', () => {
    /*
     * `AdminUsersService.setRole` revokes nothing: a demoted account keeps its
     * sessions, its points and its standing, and only the admin surface
     * closes. An operator who expected a suspension would not follow up.
     */
    const hint = roleChangeFor('ADMIN')?.hint ?? '';

    expect(hint).toMatch(/not a suspension/i);
    expect(hint).toMatch(/points/i);
  });

  it('promises no more than the API delivers about when it takes effect', () => {
    // `JwtAuthGuard` reads the role from the database on every request, so the
    // change lands on the next one — not at the next sign-in.
    expect(roleChangeFor('USER')?.hint).toMatch(/next request/i);
    expect(roleChangeFor('ADMIN')?.hint).toMatch(/next request/i);
  });

  it('offers nothing for a role this build does not recognise', () => {
    // Null rather than a guess: a button labelled from a fallback would be a
    // privilege change described by a word nobody chose.
    expect(roleChangeFor('OWNER' as never)).toBe(null);
  });
});
