import {
  USER_ROLES,
  type AdminFraudEvaluationDetail,
  type AdminFraudEvaluationSummary,
  type AdminHeldConversionSummary,
  type Paginated,
  type UserFraudSignals,
} from '@gemone/contracts';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AdminFraudService } from './admin-fraud.service';
import {
  AdminListEvaluationsDto,
  AdminListHeldConversionsDto,
  ReviewHeldConversionDto,
} from './dto/fraud.dto';

/**
 * The fraud review surface — PROJECT.md §4.7.
 *
 * *"Scores are advisory: high-risk conversions are credited but **held** (not
 * withdrawable) pending admin review, rather than rejected outright."* This is
 * where that review happens, and where the held points either mature or go
 * back.
 *
 * No fraud logic here. The engine scored, `conversions` owns the status, and
 * `RewardAccountingService` moves the points (P2); this layer supplies the
 * actor and the request context (ARCHITECTURE.md §4.3).
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/fraud')
export class AdminFraudController {
  constructor(private readonly fraud: AdminFraudService) {}

  /** Everything waiting on a decision, oldest first. */
  @Get('held')
  async held(
    @Query() query: AdminListHeldConversionsDto,
  ): Promise<Paginated<AdminHeldConversionSummary>> {
    return this.fraud.heldQueue(query);
  }

  /**
   * Resolve one hold.
   *
   * `CLEAR` matures the credit; `CONFIRM` reverses it. Both are audited with
   * the reason inside the same transaction as the money movement.
   */
  @Post('held/:id/review')
  async review(
    @Param('id', createUuidPipe()) id: string,
    @Body() body: ReviewHeldConversionDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminHeldConversionSummary> {
    return this.fraud.review(id, body.decision, body.reason, {
      adminId: admin.id,
      ip: request.ip ?? null,
    });
  }

  /** The evidence trail, for an investigation that starts anywhere. */
  @Get('evaluations')
  async evaluations(
    @Query() query: AdminListEvaluationsDto,
  ): Promise<{ items: AdminFraudEvaluationSummary[]; total: number }> {
    return this.fraud.evaluations(query);
  }

  /**
   * One evaluation in full — which rules fired, at what thresholds, and which
   * never ran.
   *
   * The threshold snapshot is the reason this endpoint exists rather than a
   * link to the configuration screen: thresholds are tuned continuously (P3),
   * and current configuration answers a different question than "what held
   * this, last month" (DATABASE.md §3.6).
   */
  @Get('evaluations/:id')
  async evaluation(
    @Param('id', createUuidPipe()) id: string,
  ): Promise<AdminFraudEvaluationDetail> {
    return this.fraud.evaluationDetail(id);
  }

  /** An account's fraud history, as the payout review screen shows it (§11.3). */
  @Get('users/:id/signals')
  async signals(
    @Param('id', createUuidPipe()) id: string,
  ): Promise<UserFraudSignals> {
    return this.fraud.signalsFor(id);
  }
}
