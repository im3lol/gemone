import {
  ADMIN_ACTIONS,
  CONVERSION_STATUSES,
  FRAUD_REVIEW_DECISIONS,
  type AdminFraudEvaluationDetail,
  type AdminFraudEvaluationSummary,
  type AdminHeldConversionSummary,
  type FraudAction,
  type FraudReviewDecision,
  type FraudRuleId,
  type Paginated,
  type UserFraudSignals,
} from '@gemone/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service';
import { CLOCK, type Clock } from '../../core/time/clock';
import { Inject } from '@nestjs/common';
import type { Conversion } from '../../generated/prisma/client';
import { ConversionsService } from '../conversions/conversions.service';
import { FraudService } from '../fraud/fraud.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminActionContext } from './admin-users.service';

/**
 * The fraud review screen — PROJECT.md §4.7's *"pending admin review"*.
 *
 * A composition layer (ARCHITECTURE.md §4.3) with no fraud logic of its own:
 * `FraudService` owns the evidence, `ConversionsService` owns the status and
 * the hold resolution, `RewardAccountingService` moves every point (P2), and
 * this supplies the actor, opens the transaction and records who decided what.
 *
 * **Why this ships with the engine rather than after it.** Holding is only the
 * recoverable direction if somebody can recover it. An engine that fills a
 * queue nothing can empty strands real users' points indefinitely, which is
 * exactly the failure TODO T29 described and named "not the design".
 */
@Injectable()
export class AdminFraudService {
  private readonly logger = new Logger(AdminFraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fraud: FraudService,
    private readonly conversions: ConversionsService,
    private readonly audit: AdminAuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Everything waiting on a human, oldest first.
   *
   * Oldest first because a held conversion is a user who earned points and
   * cannot spend them. Newest-first would let the queue's tail age forever.
   */
  async heldQueue(query: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Paginated<AdminHeldConversionSummary>> {
    const page = await this.conversions.findMany({
      status: CONVERSION_STATUSES.HELD,
      ...(query.userId ? { userId: query.userId } : {}),
      limit: query.limit,
      offset: query.offset,
      order: 'asc',
    });

    const items = await Promise.all(page.items.map((row) => this.toHeldSummary(row)));

    return { ...page, items };
  }

  /**
   * Resolve one hold.
   *
   * The status change, the balance movement and the audit entry commit
   * together — a cleared hold whose points did not mature is a user told they
   * were paid and not paid, and the audit entry is worthless if it can survive
   * a rollback of the thing it describes (§10.2 rule 5).
   */
  async review(
    conversionId: string,
    decision: FraudReviewDecision,
    reason: string,
    context: AdminActionContext,
  ): Promise<AdminHeldConversionSummary> {
    const before = await this.conversions.requireById(conversionId);

    const resolved = await this.prisma.$transaction(async (tx) => {
      const conversion = await this.conversions.resolveHold(tx, {
        conversionId,
        decision,
        reason,
        adminId: context.adminId,
        now: this.clock.now(),
      });

      await this.audit.record(tx, {
        adminId: context.adminId,
        action:
          decision === FRAUD_REVIEW_DECISIONS.CLEAR
            ? ADMIN_ACTIONS.CONVERSION_HOLD_CLEARED
            : ADMIN_ACTIONS.CONVERSION_HOLD_CONFIRMED,
        targetType: 'conversion',
        targetId: conversionId,
        before: { status: before.status, rewardPoints: before.rewardPoints },
        after: { status: conversion.status },
        reason,
        ip: context.ip,
      });

      return conversion;
    });

    this.logger.log(
      {
        conversionId,
        adminId: context.adminId,
        decision,
        status: resolved.status,
        rewardPoints: resolved.rewardPoints,
      },
      'Held conversion resolved',
    );

    return this.toHeldSummary(resolved);
  }

  // --- Evidence -------------------------------------------------------------

  async evaluations(query: {
    userId?: string;
    action?: FraudAction;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminFraudEvaluationSummary[]; total: number }> {
    const { items, total } = await this.fraud.findMany(query);

    return {
      items: await Promise.all(items.map(async (row) => this.fraud.toSummary(row, await this.conversionIdFor(row.id)))),
      total,
    };
  }

  async evaluationDetail(id: string): Promise<AdminFraudEvaluationDetail> {
    const evaluation = await this.fraud.requireById(id);

    return this.fraud.toDetail(evaluation, await this.conversionIdFor(id));
  }

  /** The signals §11.3 wants beside a withdrawal request (T32). */
  async signalsFor(userId: string): Promise<UserFraudSignals> {
    return this.fraud.signalsFor(userId);
  }

  private async conversionIdFor(evaluationId: string): Promise<string | null> {
    const conversion = await this.conversions.findByFraudEvaluationId(evaluationId);

    return conversion?.id ?? null;
  }

  private async toHeldSummary(conversion: Conversion): Promise<AdminHeldConversionSummary> {
    const evaluation = conversion.fraudEvaluationId
      ? await this.fraud.findById(conversion.fraudEvaluationId)
      : null;

    /*
     * A held conversion with no evaluation is not an error — §10.3 step 3 holds
     * inactive accounts before any rule runs, and scoring that failed leaves
     * the conversion unscored on purpose. Null score, not zero: zero would read
     * as "scored, and clean", which is the opposite of what happened.
     */
    const detail = evaluation ? this.fraud.toDetail(evaluation, conversion.id) : null;

    return {
      conversionId: conversion.id,
      userId: conversion.userId,
      rewardPoints: conversion.rewardPoints,
      reviewReason: conversion.reviewReason,
      fraudScore: detail?.score ?? null,
      triggeredRules: (detail?.triggered.map((rule) => rule.rule) ?? []) as FraudRuleId[],
      occurredAt: conversion.occurredAt?.toISOString() ?? null,
      createdAt: conversion.createdAt.toISOString(),
    };
  }
}
