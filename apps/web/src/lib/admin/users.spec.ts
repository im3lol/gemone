import { USER_ROLES, USER_STATUSES } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import {
  USER_ROLES_IN_ORDER,
  USER_STATUSES_IN_ORDER,
  isSelf,
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
