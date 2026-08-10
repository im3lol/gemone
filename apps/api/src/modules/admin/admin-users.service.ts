import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  ERROR_CODES,
  type AdminUserSummary,
  type ListUsersQuery,
  type Paginated,
  type UserStatus,
} from '@gemone/contracts';

import { PrismaService } from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { REVOCATION_REASONS } from '../auth/auth.constants';
import { TokenService } from '../auth/token.service';
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
