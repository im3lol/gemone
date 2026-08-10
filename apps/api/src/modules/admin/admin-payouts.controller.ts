import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  USER_ROLES,
  type AdminPayoutDetail,
  type AdminPayoutSummary,
  type Paginated,
} from '@gemone/contracts';
import type { Request } from 'express';

import { PrismaService } from '../../core/database/prisma.service';
import { createUuidPipe } from '../../core/errors/validation-pipe';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { PayoutsService } from '../payouts/payouts.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminPayoutsService } from './admin-payouts.service';
import {
  AdminListPayoutsDto,
  ReviewPayoutDto,
  SettlePayoutDto,
} from './dto/payout.dto';

/**
 * The payout queue — PROJECT.md §3.3, §4.8.
 *
 * The one admin surface in this codebase that moves money, and the only one
 * where a read is itself an audited action.
 *
 * Every write goes through `PayoutsService`, which owns the state machine.
 * Nothing here decides what a transition means; this layer supplies the actor,
 * the reason and the request context, which is what `admin` is for
 * (ARCHITECTURE.md §4.3).
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly details: AdminPayoutsService,
    private readonly audit: AdminAuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The queue.
   *
   * Carries **no payment destination** — DATABASE.md §3.5 puts it on the
   * detail view alone. A list endpoint returning payment destinations puts
   * every user's bank details in one response, one browser cache and one
   * screenshot.
   */
  @Get()
  async list(
    @Query() query: AdminListPayoutsDto,
  ): Promise<Paginated<AdminPayoutSummary>> {
    const page = await this.payouts.findMany(query);

    return {
      ...page,
      items: page.items.map((payout) => this.payouts.toAdminSummary(payout)),
    };
  }

  /**
   * One request, with the destination and the review context.
   *
   * **Reading this writes an audit entry.** DATABASE.md §3.5 requires the view
   * that exposes a payment destination to be audited, and it is right to:
   * "who looked at this user's bank details, and when" is a question that gets
   * asked after the details turn up somewhere they should not have.
   *
   * A GET with a side effect is a deliberate exception, not an oversight. The
   * alternative — a POST that reads — would hide the exception behind a verb
   * and make the surface harder to reason about, not easier.
   */
  @Get(':id')
  async detail(
    @Param('id', createUuidPipe()) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminPayoutDetail> {
    const payout = await this.payouts.requireById(id);

    await this.audit.record(this.prisma, {
      adminId: admin.id,
      action: ADMIN_ACTIONS.PAYOUT_DESTINATION_VIEWED,
      targetType: 'payout_request',
      targetId: payout.id,
      // Never the destination itself. The entry records that it was read, not
      // what was read — an audit trail holding the secret it audits is a second
      // copy of the secret (§16.4).
      after: { userId: payout.userId, status: payout.status },
      ip: request.ip ?? null,
    });

    return this.details.detail(payout);
  }

  /**
   * Approves. Moves no money — the admin now goes and sends it (§11.3).
   *
   * A reason is optional here and mandatory everywhere else: approving is the
   * expected outcome and needs no defence, while refusing someone's money does.
   */
  @Post(':id/approve')
  async approve(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: ReviewPayoutDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminPayoutSummary> {
    return this.details.approve(id, dto.reason, {
      adminId: admin.id,
      ip: request.ip ?? null,
    });
  }

  /**
   * Records the money as sent, with the reference it produced.
   *
   * Separate from approval because the external payment happens between them.
   * Collapsing the two would mark money paid before it was.
   */
  @Post(':id/settle')
  async settle(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: SettlePayoutDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminPayoutSummary> {
    return this.details.settle(id, dto.externalReference, {
      adminId: admin.id,
      ip: request.ip ?? null,
    });
  }

  /** Refuses, with a mandatory reason. The points go back. */
  @Post(':id/reject')
  async reject(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: ReviewPayoutDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminPayoutSummary> {
    return this.details.reject(id, dto.reason, {
      adminId: admin.id,
      ip: request.ip ?? null,
    });
  }

  /**
   * Records that an approved payment did not go through. The points go back.
   *
   * Distinct from rejection: a rejection is a decision about the user, a
   * failure is a fact about the payment. They read identically on a balance
   * and completely differently in a dispute.
   */
  @Post(':id/fail')
  async fail(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: ReviewPayoutDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminPayoutSummary> {
    return this.details.markFailed(id, dto.reason, {
      adminId: admin.id,
      ip: request.ip ?? null,
    });
  }
}
