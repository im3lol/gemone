import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  ERROR_CODES,
  type AdminUserSummary,
  type Balance,
  type ListUsersQuery,
  type Paginated,
  type UserStatus,
} from '@gemone/contracts';

import { PrismaService } from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { REVOCATION_REASONS } from '../auth/auth.constants';
import { TokenService } from '../auth/token.service';
import { RewardAccountingService } from '../rewards/reward-accounting.service';
import { UsersService } from '../users/users.service';
import { AdminAuditService } from './admin-audit.service';

export interface AdminActionContext {
  adminId: string;
  ip?: string | null;
}

/**
 * Administrative operations on users.
 *
 * A composition layer (ARCHITECTURE.md §4.3): it calls `UsersService` for the
 * rules, `TokenService` for sessions, and `AdminAuditService` for the record.
 * It holds no business logic of its own, and it queries no other module's
 * tables — `refresh_tokens` belongs to `auth` (DATABASE.md §11.1).
 *
 * The reason that matters: the common failure is an admin panel that grows a
 * parallel implementation of the same rules, which then drifts — and the
 * admin path is the one that is wrong, and the one that moves money.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly rewards: RewardAccountingService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<Paginated<AdminUserSummary>> {
    const page = await this.users.findMany(query);

    // Session counts for the whole page in one query rather than one per row.
    const counts = await this.tokens.countActiveSessions(page.items.map((u) => u.id));

    return {
      ...page,
      items: page.items.map((user) =>
        UsersService.toAdminSummary(user, counts.get(user.id) ?? 0),
      ),
    };
  }

  async get(id: string): Promise<AdminUserSummary> {
    const user = await this.users.requireById(id);
    const counts = await this.tokens.countActiveSessions([id]);

    return UsersService.toAdminSummary(user, counts.get(id) ?? 0);
  }

  /**
   * Another account's three buckets — TODO T84.
   *
   * ## Composed, never recomputed
   *
   * `RewardAccountingService.getBalance` is the whole implementation, for the
   * reason P2 exists: the accounting service is the only thing permitted to
   * read balance state, and an admin surface that summed conversions instead
   * would be a second answer to "how many points does this account have" —
   * one that ignores maturation, chargebacks and locks, and that is wrong in
   * exactly the cases somebody opens an admin screen to investigate. The
   * arithmetic is not repeated here because there is no arithmetic here.
   *
   * This is the same call `reviewContext` already makes; T84 is that the
   * answer was reachable only bundled inside a payout detail, so an account
   * that had never requested a withdrawal had no balance an admin could see.
   *
   * ## The existence check is not ceremony
   *
   * `getBalance` answers zeros for an account with no stored balance rather
   * than throwing — correct for its own caller, since the row is created with
   * the user and "nothing has moved yet" *is* a balance of nothing. But
   * without `requireById`, a mistyped id would answer `200` with seven zeros,
   * and an operator would read "this account has no points" where the truth is
   * "this account does not exist". Asking the user module first keeps those
   * two apart, and costs one indexed lookup.
   *
   * ## Not audited, deliberately
   *
   * A payout destination is audited on read because reading where somebody's
   * money goes is an action (§16.4). A balance is not a secret of that kind:
   * it is the same class of fact as the fraud signals and the conversion list
   * beside it, none of which are audited, and `PayoutReviewContext` has
   * carried these three numbers to admins since Feature 6 with no entry
   * written. Auditing it here and nowhere else would make the trail describe
   * which screen was used rather than what was done.
   */
  async balanceFor(userId: string): Promise<Balance> {
    await this.users.requireById(userId);

    return this.rewards.getBalance(userId);
  }

  /**
   * Changes a user's standing, revokes their sessions, and records why.
   *
   * All three in ONE transaction (DATABASE.md §10.1). Partial completion is
   * the failure that matters here: a user marked suspended whose sessions were
   * never revoked keeps full access, and the audit trail would show an action
   * that did not fully happen.
   */
  async setStatus(
    targetUserId: string,
    status: UserStatus,
    reason: string,
    context: AdminActionContext,
  ): Promise<AdminUserSummary> {
    if (targetUserId === context.adminId) {
      // An admin suspending themselves locks the platform's own operator out,
      // and on a single-admin deployment that is unrecoverable without
      // database access.
      throw new DomainError(
        ERROR_CODES.ADMIN_SELF_ACTION_FORBIDDEN,
        'You cannot change your own account status',
        403,
      );
    }

    const before = await this.users.requireById(targetUserId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await this.users.updateStatus(targetUserId, status, tx);

      // A suspended user must stop being able to act immediately. The auth
      // guard re-reads status on every request (§8.3), so access tokens stop
      // working within their remaining lifetime; revoking refresh tokens here
      // closes the much longer window.
      if (!UsersService.isActive(user)) {
        await this.tokens.revokeAllForUser(
          targetUserId,
          REVOCATION_REASONS.LOGOUT,
          tx,
        );
      }

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.USER_STATUS_CHANGED,
        targetType: 'user',
        targetId: targetUserId,
        before: { status: before.status },
        after: { status: user.status },
        reason,
        ip: context.ip ?? null,
      });

      return user;
    });

    this.logger.warn(
      {
        adminId: context.adminId,
        targetUserId,
        from: before.status,
        to: updated.status,
      },
      'Admin changed user status',
    );

    const counts = await this.tokens.countActiveSessions([targetUserId]);
    return UsersService.toAdminSummary(updated, counts.get(targetUserId) ?? 0);
  }

  /**
   * Ends every session a user holds without changing their standing.
   *
   * For a session believed compromised while the account itself is fine — the
   * user simply logs in again.
   */
  async revokeSessions(
    targetUserId: string,
    reason: string,
    context: AdminActionContext,
  ): Promise<{ revoked: number }> {
    await this.users.requireById(targetUserId);

    const revoked = await this.prisma.$transaction(async (tx) => {
      const count = await this.tokens.revokeAllForUser(
        targetUserId,
        REVOCATION_REASONS.LOGOUT,
        tx,
      );

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: ADMIN_ACTIONS.USER_SESSIONS_REVOKED,
        targetType: 'user',
        targetId: targetUserId,
        after: { revokedSessions: count },
        reason,
        ip: context.ip ?? null,
      });

      return count;
    });

    return { revoked };
  }
}
