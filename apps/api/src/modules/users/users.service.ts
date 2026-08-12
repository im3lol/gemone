import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type AdminUserSummary,
  type ListUsersQuery,
  type Paginated,
  type UserProfile,
  type UserRole,
  type UserStatus,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { RewardAccountingService } from '../rewards/reward-accounting.service';
import type { Prisma, User } from '../../generated/prisma/client';

/** What `auth` needs to create an account. */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  registrationIp?: string | undefined;
  registrationCountry?: string | undefined;
  locale?: string | undefined;
}

/**
 * Owner of the `users` table — DATABASE.md §11.
 *
 * Every other module reaches user data through this service. `auth` depends
 * on it (ARCHITECTURE.md §4.1) and never queries `users` directly.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardAccountingService,
  ) {}

  /**
   * Emails are stored already normalised, so the unique constraint is
   * effectively case-insensitive without a citext extension.
   *
   * Normalisation lives here — the one module that owns the column — rather
   * than at each call site, because "Alice@example.com" and
   * "alice@example.com " creating two accounts is a support problem that only
   * surfaces after both exist.
   */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async create(input: CreateUserInput): Promise<User> {
    const email = UsersService.normalizeEmail(input.email);

    // The unique constraint is the actual guard against duplicates; this
    // check exists to return a useful error, not to prevent the race. Two
    // concurrent registrations both pass it and the database rejects the
    // loser — handled below.
    try {
      /*
       * One transaction: create the user, then open their balance
       * (DATABASE.md §10.1). The balance row is created **with the user**, not
       * lazily on first credit — a missing balance during a credit is an error
       * path nobody tests, and an always-present zero row is one less branch
       * (DATABASE.md §3.5).
       *
       * The insert itself is delegated to `RewardAccountingService`, which is
       * the only thing permitted to write that table (P2). Doing it here would
       * be an exception to the rule `arch.spec.ts` exists to enforce, and an
       * exception granted once is an exception someone extends.
       */
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: uuidv7(),
            email,
            passwordHash: input.passwordHash,
            registrationIp: input.registrationIp ?? null,
            registrationCountry: input.registrationCountry ?? null,
            ...(input.locale ? { locale: input.locale } : {}),
          },
        });

        await this.rewards.openAccount(user.id, tx);

        return user;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'email')) {
        throw new DomainError(
          ERROR_CODES.AUTH_EMAIL_TAKEN,
          'An account with this email already exists',
          409,
          { email },
        );
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: UsersService.normalizeEmail(email) },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Shapes a row for the API — ARCHITECTURE.md §19.3.
   *
   * Explicit field selection, not omission of known-bad fields. A blocklist
   * silently leaks whatever column is added next; this leaks nothing, and a
   * new field has to be deliberately added here to become public.
   */
  static toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Only ACTIVE accounts may hold a session (ARCHITECTURE.md §8.3). */
  static isActive(user: User): boolean {
    return user.status === 'ACTIVE';
  }

  // --- Self-service ------------------------------------------------------

  /**
   * Updates the fields a user may change about themselves.
   *
   * Deliberately narrow. Email is not here: changing it is an identity change
   * that needs verification of the new address, and verification is out of
   * MVP scope (PROJECT.md §5). Role and status are not here for the obvious
   * reason.
   */
  async updateProfile(id: string, changes: { locale?: string }): Promise<User> {
    const data: Prisma.UserUpdateInput = {};
    if (changes.locale !== undefined) data.locale = changes.locale;

    if (Object.keys(data).length === 0) {
      // Nothing to do. Returning the current row beats a no-op write that
      // bumps updated_at and makes the audit trail read as if something
      // changed.
      return this.requireById(id);
    }

    return this.prisma.user.update({ where: { id }, data });
  }

  /**
   * Takes an optional transaction client so a password reset can spend its
   * token, set the hash and revoke the sessions in one transaction
   * (DATABASE.md §10.1) — the same reason `updateStatus` takes one.
   */
  async updatePasswordHash(
    id: string,
    passwordHash: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<User> {
    return client.user.update({ where: { id }, data: { passwordHash } });
  }

  // --- Administration ----------------------------------------------------

  /**
   * The rows every last-administrator decision is made from — TODO T85, T89.
   *
   * `SELECT … FOR UPDATE` over exactly the set `assertAnAdminRemains` counts,
   * taken **before anything is read**. It is what turns a check into a
   * guarantee: two transactions that both want to change who can administer
   * the platform contend here, and the second one blocks until the first has
   * committed, so the count it takes afterwards describes the world the first
   * actually left.
   *
   * Deliberately one statement shared by the role change and the status
   * change, rather than one per endpoint. They can reach the same empty
   * platform *together* — an administrator demoted by one request while the
   * only other one is suspended by another — and two different lock sets would
   * not see each other. Both take this, so both serialize.
   *
   * `users` is this module's own table (DATABASE.md §11.1); the casts name the
   * Postgres types the Prisma enums map to. Postgres locks rows in scan order,
   * and both callers issue the identical statement, so there is no ordering
   * for two transactions to deadlock over.
   */
  private async lockActiveAdmins(tx: PrismaTransactionClient): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM users
       WHERE role = 'ADMIN'::user_role AND status = 'ACTIVE'::user_status
       FOR UPDATE`;
  }

  /**
   * Refuses a write that would leave nobody able to administer the platform.
   *
   * Called **after** the write, inside the same transaction, so what it counts
   * is the world the caller is proposing rather than the one they started in.
   * Throwing rolls that write back — the interlock is the transaction, not a
   * compensating update.
   *
   * ## Why the count is of ACTIVE administrators
   *
   * `JwtAuthGuard` rejects any account that is not `ACTIVE` before its role is
   * ever consulted, so a suspended administrator is not an administrator who
   * can act. Counting rows by role alone would let the last usable operator be
   * suspended or demoted while a banned row kept the total at one, and the
   * platform would be locked out with the count still reading "fine".
   *
   * ## Why zero is unrecoverable, and one is not
   *
   * A platform with no administrator who can sign in cannot register a
   * provider, change a configuration value or approve a payout — and cannot
   * appoint or reinstate an administrator either, because both of those are
   * administrative endpoints. `create-admin.js` is not the way back: it sets
   * `role` and does not touch `status`, so against a suspended administrator it
   * reports success and changes nothing that matters. The only recovery is SQL
   * against the database, which is exactly the situation ARCHITECTURE.md §8.4's
   * "or by an existing admin" exists to avoid.
   */
  private async assertAnAdminRemains(
    tx: PrismaTransactionClient,
    id: string,
  ): Promise<void> {
    const remaining = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });

    if (remaining > 0) return;

    throw new DomainError(
      ERROR_CODES.ADMIN_LAST_ADMIN_PROTECTED,
      'That would leave the platform with no administrator who can sign in',
      409,
      { id },
    );
  }

  /**
   * Changes a user's standing — TODO T89 for the interlock.
   *
   * The business rule — which transitions are legal — lives here, in the
   * module that owns users; `admin` orchestrates but holds no logic (§4.3).
   *
   * ## The last-administrator interlock
   *
   * `AdminUsersService.setStatus` already refuses an administrator changing
   * their **own** standing, so one request cannot reach zero administrators:
   * the caller is an active administrator and is not the row being written.
   * **Two can.** Two administrators suspending each other at the same moment
   * are two legal requests — neither is a self-action, and each one, checked on
   * its own, leaves an administrator behind. Both commit, and the platform is
   * left with administrators who all fail `isActive`.
   *
   * That is write skew, and it is the same shape T85 found on the role column
   * (D100): no check made before the write fixes it, because both checks pass.
   * So this takes the same lock and makes the same assertion — one mechanism,
   * two columns.
   *
   * **Nothing here forbids suspending an administrator.** The assertion is
   * about what is left, not about who is being changed: another administrator
   * may still be suspended, banned, closed and reinstated, and reactivating one
   * can only raise the count. Only the last active administrator is protected,
   * and only against actually being the last.
   *
   * Requires a transaction client — no default. A lock is only a lock for as
   * long as the transaction lives, and a default of `this.prisma` would take
   * one and release it a statement later, which reads as protection and is
   * none.
   */
  async updateStatus(
    id: string,
    status: UserStatus,
    tx: PrismaTransactionClient,
  ): Promise<User> {
    /*
     * Taken unconditionally, including when the target is an ordinary user.
     * Branching on "could this one matter?" would be a second, quieter copy of
     * the invariant — and the case it would skip is the case where another
     * transaction is concurrently changing who can administer the platform,
     * which is precisely when the answer is hardest to get right. A status
     * change is a rare administrative action; one indexed statement is not a
     * cost worth a branch (P6).
     */
    await this.lockActiveAdmins(tx);

    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw userNotFound(id);

    if (user.status === status) {
      throw new DomainError(
        ERROR_CODES.USER_INVALID_STATUS_TRANSITION,
        `User is already ${status}`,
        409,
      );
    }

    if (!UsersService.canTransition(user.status, status)) {
      throw new DomainError(
        ERROR_CODES.USER_INVALID_STATUS_TRANSITION,
        `Cannot change status from ${user.status} to ${status}`,
        409,
        { from: user.status, to: status },
      );
    }

    const updated = await tx.user.update({ where: { id }, data: { status } });

    await this.assertAnAdminRemains(tx, id);

    return updated;
  }

  /**
   * Promotes or demotes an account — TODO T85, ARCHITECTURE.md §8.4.
   *
   * §8.4 has always said admin accounts are provisioned "by a seed script or
   * **by an existing admin**". `create-admin.js` is the first half; this is the
   * second, and it writes the same column that script writes.
   *
   * The rule lives here rather than in `admin` for the reason `updateStatus`
   * records: `admin` orchestrates and holds no logic (§4.3), and the module
   * that owns the table is the one that can enforce a rule *about the table*.
   *
   * ## The interlock, and why it needs the lock above it
   *
   * A platform with no administrator who can sign in cannot register a
   * provider, change a configuration value or approve a payout — and cannot
   * appoint a new administrator either, because that is this endpoint. The only
   * recovery is shell access to run `create-admin`, which is exactly the
   * situation §8.4's second half exists to avoid.
   *
   * `AdminUsersService.setRole` already refuses to let an administrator demote
   * themselves, so a single request cannot reach zero. **Two can.** Two
   * administrators demoting each other at the same moment are two legal
   * requests: each reads one other administrator, each writes, and the
   * platform is left with none. That is write skew, and no amount of checking
   * before the write fixes it — both checks pass.
   *
   * So every role change first takes `FOR UPDATE` on the rows it is about to
   * count. The second transaction blocks until the first commits and then
   * counts what is actually there. The mechanism is the one this codebase
   * already uses wherever a decision is made from a row that another writer
   * may be moving (§9.5, D97); the count is taken **after** the write, so what
   * it reports is the world the caller is proposing.
   *
   * **The lock and the assertion are shared with `updateStatus`** — TODO T89.
   * A demotion and a suspension can reach the same empty platform together, so
   * they contend for the same rows rather than each guarding its own column.
   *
   * Requires a transaction client — no default. The lock is only a lock for as
   * long as the transaction lives, and a default of `this.prisma` would take
   * one and release it a statement later, which reads as protection and is
   * none.
   */
  async updateRole(
    id: string,
    role: UserRole,
    tx: PrismaTransactionClient,
  ): Promise<User> {
    await this.lockActiveAdmins(tx);

    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw userNotFound(id);

    if (user.role === role) {
      // A button whose success is indistinguishable from doing nothing, and an
      // audit entry recording a change that did not happen.
      throw new DomainError(
        ERROR_CODES.USER_ROLE_UNCHANGED,
        `User is already ${role}`,
        409,
        { role },
      );
    }

    const updated = await tx.user.update({ where: { id }, data: { role } });

    await this.assertAnAdminRemains(tx, id);

    return updated;
  }

  /**
   * Permitted status transitions.
   *
   * CLOSED is terminal: a user who exercised their right to have personal
   * data anonymised (DATABASE.md §7.3) cannot be reactivated, because the
   * data needed to reactivate them is gone. Everything else is reversible —
   * an admin who bans the wrong account must be able to undo it.
   */
  static canTransition(from: UserStatus, to: UserStatus): boolean {
    if (from === 'CLOSED') return false;
    return to !== from;
  }

  async findMany(query: ListUsersQuery): Promise<Paginated<User>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.email
        ? { email: { contains: UsersService.normalizeEmail(query.email) } }
        : {}),
    };

    // One round trip for the page and one for the count. Counting is a
    // separate query on purpose: an admin list needs the total to render
    // pagination, and deriving it from the page is only correct on the last
    // page.
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async requireById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw userNotFound(id);
    return user;
  }

  /**
   * The admin view of a user: the public profile plus operational state.
   *
   * Still an allowlist — it adds fields an admin legitimately needs and
   * continues to exclude the password hash, the TOTP secret and the
   * registration IP. "Admin" is not a reason to serialise secrets.
   */
  static toAdminSummary(user: User, activeSessionCount: number): AdminUserSummary {
    return {
      ...UsersService.toProfile(user),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      registrationCountry: user.registrationCountry,
      updatedAt: user.updatedAt.toISOString(),
      activeSessionCount,
    };
  }
}

/** Admin lists are paged; an unbounded limit is a table scan someone can request. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

function userNotFound(id: string): DomainError {
  return new DomainError(ERROR_CODES.USER_NOT_FOUND, 'User not found', 404, { id });
}

export const __testing = { clampLimit, DEFAULT_LIMIT, MAX_LIMIT };

/**
 * Recognises Postgres 23505 as surfaced by Prisma's P2002.
 *
 * Kept narrow on purpose: a broad `catch` around `create` that assumes every
 * failure is a duplicate email would report "email taken" when the database
 * is down.
 */
function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === 'string') return target.includes(field);

  // P2002 with no usable target still means a uniqueness conflict, and the
  // only unique column on this table is email.
  return true;
}
