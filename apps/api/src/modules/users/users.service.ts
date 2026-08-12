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
   * Changes a user's standing.
   *
   * Takes an optional transaction client so the caller can write the audit
   * entry and revoke sessions in the same transaction (DATABASE.md §10.1).
   * The business rule — which transitions are legal — lives here, in the
   * module that owns users; `admin` orchestrates but holds no logic (§4.3).
   */
  async updateStatus(
    id: string,
    status: UserStatus,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<User> {
    const user = await client.user.findUnique({ where: { id } });
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

    return client.user.update({ where: { id }, data: { status } });
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
   * ## Why the count is of ACTIVE administrators
   *
   * `JwtAuthGuard` rejects any account that is not `ACTIVE` before the role is
   * ever consulted, so a suspended administrator is not an administrator who
   * can act. Counting rows by role alone would let the last usable operator be
   * demoted while a banned row kept the total at one.
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
    /*
     * Taken before anything is read, and covering every row the count below
     * will see. `users` is this module's own table (DATABASE.md §11.1); the
     * enum casts name the Postgres types the Prisma enums map to.
     */
    await tx.$queryRaw`
      SELECT id FROM users
       WHERE role = 'ADMIN'::user_role AND status = 'ACTIVE'::user_status
       FOR UPDATE`;

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

    const remaining = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });

    if (remaining === 0) {
      // Throwing rolls the update back — the interlock is the transaction, not
      // a compensating write.
      throw new DomainError(
        ERROR_CODES.ADMIN_LAST_ADMIN_PROTECTED,
        'That would leave the platform with no administrator who can sign in',
        409,
        { id },
      );
    }

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
