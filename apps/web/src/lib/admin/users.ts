import { USER_ROLES, USER_STATUSES } from '@gemone/contracts';
import type { UserRole, UserStatus } from '@gemone/contracts';

/**
 * The user administration screen's vocabulary — ARCHITECTURE.md §8.4.
 *
 * Pure, and holding no rule the API does not already enforce. What an admin
 * may do to an account is `AdminUsersService.setStatus` and
 * `revokeSessions`; what a status *means* is `UsersService.isActive` and the
 * auth guard that re-reads it on every request. This module says those in
 * English and nothing more.
 *
 * ## Why there is no status state machine here
 *
 * `UpdateUserStatusDto` validates with `@IsIn(STATUSES)` and nothing else —
 * any status may follow any other, deliberately: an account banned in error
 * has to be reachable again, and a machine that forbade it would need an
 * override that is the same transition with a longer name. `$lib/admin/
 * payout-queue.ts` mirrors a real state machine because `payout-state-machine.
 * ts` *is* one. Mirroring a machine that does not exist would be inventing it.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type UserTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface UserState {
  label: string;
  tone: UserTone;
  /** What this status means for the person holding the account. */
  hint: string;
}

/**
 * The four statuses, in the words an operator reasons about.
 *
 * The differences that matter are about *access* and *reversibility*, because
 * those are what the code behind them actually does: anything other than
 * `ACTIVE` fails `UsersService.isActive`, which revokes every session inside
 * the same transaction as the change.
 */
const STATES: Record<UserStatus, UserState> = {
  ACTIVE: {
    label: 'Active',
    tone: 'success',
    hint: 'Can sign in, earn and withdraw.',
  },
  SUSPENDED: {
    label: 'Suspended',
    tone: 'warning',
    hint: 'Signed out and locked out, pending a decision. Points are untouched.',
  },
  BANNED: {
    label: 'Banned',
    tone: 'error',
    hint: 'Signed out and locked out for good. Points are untouched — reversing a credit is a fraud decision, not a status change.',
  },
  CLOSED: {
    label: 'Closed',
    tone: 'neutral',
    hint: 'The account is finished with. Signed out, and no longer counted as active.',
  },
};

export const USER_STATUSES_IN_ORDER: UserStatus[] = Object.values(USER_STATUSES);
export const USER_ROLES_IN_ORDER: UserRole[] = Object.values(USER_ROLES);

/**
 * The fallback exists because the status is a wire value — a newer server, a
 * replayed record. A lookup returning `undefined` would render "undefined"
 * beside somebody's account.
 */
export function userState(status: UserStatus): UserState {
  return STATES[status] ?? { label: 'Unknown', tone: 'neutral', hint: '' };
}

export function statusLabel(status: UserStatus): string {
  return userState(status).label;
}

const ROLES: Record<UserRole, string> = {
  USER: 'User',
  ADMIN: 'Admin',
};

export function roleLabel(role: UserRole): string {
  return ROLES[role] ?? role;
}

/**
 * Which status changes to offer for an account currently in `status`.
 *
 * Every status except the current one, because the API permits every one of
 * them. This is not a state machine and does not pretend to be — it exists so
 * a screen does not offer "Suspend" to an account that is already suspended,
 * which is a button whose success would be indistinguishable from doing
 * nothing.
 */
export function statusChangesFor(status: UserStatus): UserStatus[] {
  return USER_STATUSES_IN_ORDER.filter((candidate) => candidate !== status);
}

/**
 * Whether an admin may act on this account at all.
 *
 * `AdminUsersService.setStatus` refuses `targetUserId === adminId` with a 403:
 * an admin suspending themselves locks the platform's operator out, and on a
 * single-admin deployment that is unrecoverable without database access. The
 * screen asks the same question so it can explain rather than offer a control
 * that is certain to fail — the API remains the control.
 */
export function isSelf(userId: string, adminId: string | undefined): boolean {
  return Boolean(adminId) && userId === adminId;
}

/**
 * A verb for the change, rather than the status as a noun.
 *
 * "Ban" is what the operator is about to do; "Banned" is what the account will
 * be. A button labelled with the resulting state reads, at the moment of
 * pressing, like a description of the present.
 */
const VERBS: Record<UserStatus, string> = {
  ACTIVE: 'Reinstate',
  SUSPENDED: 'Suspend',
  BANNED: 'Ban',
  CLOSED: 'Close',
};

export function statusVerb(status: UserStatus): string {
  return VERBS[status] ?? statusLabel(status);
}

/**
 * How loud the control should be.
 *
 * `BANNED` is the only one styled as destructive. It is not technically
 * irreversible — every status can follow every other — but it is the one an
 * operator should have to mean, and the tone is the only warning a button
 * carries.
 */
export function statusVariant(status: UserStatus): 'primary' | 'secondary' | 'danger' {
  if (status === USER_STATUSES.BANNED) return 'danger';
  if (status === USER_STATUSES.ACTIVE) return 'primary';

  return 'secondary';
}

/**
 * An account id, shortened for a table.
 *
 * The full value stays in the `title` and in the link, because that is what an
 * operator pastes into a ticket. This is only what a column can hold.
 */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}
