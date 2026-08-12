import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  USER_ROLES,
  type AdminUserSummary,
  type AuditLogEntry,
  type Balance,
  type Paginated,
} from '@gemone/contracts';
import type { Request } from 'express';

import { createUuidPipe } from '../../core/errors/validation-pipe';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService, type AdminActionContext } from './admin-users.service';
import { ListAuditLogDto, ListUsersDto, RevokeSessionsDto, UpdateUserStatusDto } from './dto/admin.dto';

/**
 * The administrative surface — ARCHITECTURE.md §8.4, §19.1.
 *
 * A distinct trust zone, not a role flag on the same door: its own path
 * prefix, its own guard declaration at the class level, and every action
 * audited.
 *
 * `@Roles(ADMIN)` is applied to the CONTROLLER, not to individual handlers.
 * A per-handler declaration is one someone can forget on the next endpoint
 * they add, and a forgotten role check on an admin route is an unauthenticated
 * admin action. Declaring it once means new endpoints are protected by
 * default.
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('users')
  async listUsers(@Query() query: ListUsersDto): Promise<Paginated<AdminUserSummary>> {
    return this.adminUsers.list(query);
  }

  @Get('users/:id')
  async getUser(
    @Param('id', createUuidPipe()) id: string,
  ): Promise<AdminUserSummary> {
    return this.adminUsers.get(id);
  }

  /**
   * One account's three buckets — TODO T84.
   *
   * `GET /rewards/balance` is the owner's own and takes no parameter at all,
   * because ownership is never something a caller supplies (§6.2). This is the
   * administrative read of the same figures, and it lives under `users/:id`
   * rather than under `rewards` for that reason: the resource is the account,
   * and the account is what the role check and the audit trail are about.
   *
   * Returns `Balance` verbatim — the accounting service's own shape, including
   * the lifetime totals, which are the figures that answer "has this account
   * ever been paid" without opening the payout queue. Nothing is reshaped for
   * the admin, so there is no admin-only definition of a balance to drift.
   */
  @Get('users/:id/balance')
  async getUserBalance(@Param('id', createUuidPipe()) id: string): Promise<Balance> {
    return this.adminUsers.balanceFor(id);
  }

  @Patch('users/:id/status')
  async setUserStatus(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminUserSummary> {
    return this.adminUsers.setStatus(id, dto.status, dto.reason, contextOf(admin, request));
  }

  @Post('users/:id/revoke-sessions')
  async revokeUserSessions(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: RevokeSessionsDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<{ revoked: number }> {
    return this.adminUsers.revokeSessions(id, dto.reason, contextOf(admin, request));
  }

  /**
   * The audit trail is readable but not writable through the API, and there
   * is deliberately no delete endpoint — these rows are never removed
   * (DATABASE.md §7.1).
   */
  @Get('audit-log')
  async listAuditLog(@Query() query: ListAuditLogDto): Promise<Paginated<AuditLogEntry>> {
    return this.audit.find(query);
  }
}

function contextOf(admin: AuthenticatedUser, request: Request): AdminActionContext {
  return { adminId: admin.id, ip: request.ip ?? null };
}
