import { USER_ROLES, USER_STATUSES } from '@gemone/contracts';
import type { Balance, UserRole, UserStatus } from '@gemone/contracts';

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
 * Appointing and removing administrators — TODO T85.
 *
 * ARCHITECTURE.md §8.4: admin accounts are provisioned "by a seed script or by
 * an existing admin". The second half is `PATCH /admin/users/:id/role`, and
 * this is what a screen says about it.
 *
 * **One change, because there are two roles.** The target is derived rather
 * than chosen: a select with two options, one of which the account already
 * holds, is a control whose success is indistinguishable from doing nothing —
 * the same reason `statusChangesFor` omits the current status.
 *
 * **Nothing here decides whether the change is allowed.** The refusals live in
 * the API: `AdminUsersService.setRole` rejects an administrator changing their
 * own role, and `UsersService.updateRole` refuses under a row lock any change
 * that would leave no administrator able to sign in. This module supplies
 * words.
 */
export interface RoleChange {
  /** The role the account would end in. */
  to: UserRole;
  /** The button, as the act about to be performed. */
  verb: string;
  /** What it does — and, as importantly, what it does not do. */
  hint: string;
  variant: 'primary' | 'danger';
}

const ROLE_CHANGES: Record<UserRole, RoleChange> = {
  USER: {
    to: USER_ROLES.ADMIN,
    verb: 'Make administrator',
    hint: 'Full access to the admin surface: providers, configuration, fraud decisions and every withdrawal. It takes effect on their next request, without them signing in again.',
    variant: 'primary',
  },
  ADMIN: {
    to: USER_ROLES.USER,
    verb: 'Remove administrator access',
    hint: 'The admin surface closes on their next request. The account, its sessions and its points are untouched — this is not a suspension.',
    variant: 'danger',
  },
};

/**
 * The fallback exists because the role is a wire value, the same reason
 * `userState` has one: a lookup returning `undefined` would render a button
 * labelled "undefined" beside somebody's account.
 */
export function roleChangeFor(role: UserRole): RoleChange | null {
  return ROLE_CHANGES[role] ?? null;
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

/**
 * The balance, in the words an operator answers a ticket with — TODO T84.
 *
 * ## Three buckets, never one number
 *
 * ARCHITECTURE.md §9.2, and on an admin screen the reason is sharper than on
 * the user's own: the three answer three different support questions —
 * *"why can't I withdraw"* is `pending`, *"where did my withdrawal go"* is
 * `locked`, and only `available` is the number a withdrawal may be checked
 * against. A screen that showed `total` would let an operator confirm a
 * withdrawal against points inside a hold period.
 *
 * `total` is therefore deliberately not among them. It is on the contract so
 * that nobody adds the three up wrongly, not so that it can be presented as a
 * fourth bucket beside them.
 *
 * ## Read, never derived
 *
 * Each entry names the field it reads and does no arithmetic. That is what
 * makes this list checkable: the point of T84 is that a balance summed from
 * the conversions on the same page would ignore maturation, chargebacks and
 * locks, so the one property worth a test is that these figures come from the
 * accounting service's own answer and from nowhere else.
 */
export interface BalanceBucket {
  key: 'available' | 'pending' | 'locked';
  label: string;
  /** What this bucket means for the person holding the account. */
  hint: string;
  tone: 'brand' | 'amber' | 'blue';
  /** Undefined when the balance could not be loaded — never zero. */
  points: number | undefined;
}

const BUCKETS: readonly Omit<BalanceBucket, 'points'>[] = [
  {
    key: 'available',
    label: 'Available',
    hint: 'Withdrawable now. The only bucket a withdrawal can be locked against.',
    tone: 'brand',
  },
  {
    key: 'pending',
    label: 'Pending',
    hint: 'Credited but still inside its hold period. Becomes available when the hold elapses.',
    tone: 'amber',
  },
  {
    key: 'locked',
    label: 'Reserved',
    hint: 'Held by a withdrawal that is still being decided. Consumed on settle, returned on rejection.',
    tone: 'blue',
  },
];

/**
 * `undefined` points rather than zeros when `balance` is null.
 *
 * The same rule the user's own wallet follows: a zero balance and an unknown
 * balance are different claims about somebody's money, and on this screen the
 * wrong one would be read as evidence.
 */
export function balanceBuckets(balance: Balance | null): BalanceBucket[] {
  return BUCKETS.map((bucket) => ({ ...bucket, points: balance?.[bucket.key] }));
}

/**
 * The lifetime figures, which are not buckets and are not shown as such.
 *
 * They answer a different question — what has passed *through* this account,
 * rather than what is in it — and `lifetimeWithdrawn` is the one an operator
 * reads before deciding whether a withdrawal request is this account's first.
 */
export interface LifetimeFigure {
  key: 'lifetimeEarned' | 'lifetimeWithdrawn' | 'lifetimeReversed';
  label: string;
  points: number | undefined;
}

const LIFETIME: readonly Omit<LifetimeFigure, 'points'>[] = [
  { key: 'lifetimeEarned', label: 'Earned, all time' },
  { key: 'lifetimeWithdrawn', label: 'Withdrawn, all time' },
  { key: 'lifetimeReversed', label: 'Reversed, all time' },
];

export function lifetimeFigures(balance: Balance | null): LifetimeFigure[] {
  return LIFETIME.map((figure) => ({ ...figure, points: balance?.[figure.key] }));
}
