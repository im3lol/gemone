import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  CONVERSION_STATUSES,
  CONVERSION_TYPES,
  PAYOUT_STATUSES,
  type AdminAction,
  type AdminPayoutDetail,
  type AdminPayoutSummary,
  type PayoutReviewContext,
  type PayoutStatus,
} from '@gemone/contracts';

import { PrismaService } from '../../core/database/prisma.service';
import type { PayoutRequest } from '../../generated/prisma/client';
import { ConversionsService } from '../conversions/conversions.service';
import { FraudService } from '../fraud/fraud.service';
import { PayoutsService } from '../payouts/payouts.service';
import { RewardAccountingService } from '../rewards/reward-accounting.service';
import { UsersService } from '../users/users.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminActionContext } from './admin-users.service';

/**
 * Administrative operations on the payout queue.
 *
 * A composition layer (ARCHITECTURE.md §4.3) holding no payout logic of its
 * own: `PayoutsService` owns the state machine and decides what a transition
 * means, `RewardAccountingService` moves every point (P2), and this supplies
 * the actor, opens the transaction, and records who did it.
 *
 * **The transaction is opened here**, matching every other admin-driven action
 * in this codebase (`AdminProvidersService`, `AdminUsersService`). That is what
 * puts the audit entry in the same transaction as the action it records
 * (§10.2, rule 5) without `payouts` importing `admin` while `admin` imports
 * `payouts` — see DECISIONS.md D44.
 */
@Injectable()
export class AdminPayoutsService {
  private readonly logger = new Logger(AdminPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly users: UsersService,
    private readonly rewards: RewardAccountingService,
    private readonly conversions: ConversionsService,
    private readonly fraud: FraudService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Approves. **Moves no money** — the admin now goes and sends it (§11.3).
   *
   * A reason is optional: approving is the expected outcome and needs no
   * defence, while refusing someone's money does.
   */
  async approve(
    payoutId: string,
    reason: string | undefined,
    context: AdminActionContext,
  ): Promise<AdminPayoutSummary> {
    return this.review(payoutId, PAYOUT_STATUSES.APPROVED, ADMIN_ACTIONS.PAYOUT_APPROVED, {
      reason,
      context,
    });
  }

  /** Refuses, with a mandatory reason. The points go back to `available`. */
  async reject(
    payoutId: string,
    reason: string | undefined,
    context: AdminActionContext,
  ): Promise<AdminPayoutSummary> {
    return this.review(payoutId, PAYOUT_STATUSES.REJECTED, ADMIN_ACTIONS.PAYOUT_REJECTED, {
      reason,
      context,
    });
  }

  /**
   * Records that an approved payment did not go through. The points go back.
   *
   * Distinct from rejection: a rejection is a decision about the user, a
   * failure is a fact about the payment. They read identically on a balance
   * and completely differently in a dispute.
   */
  async markFailed(
    payoutId: string,
    reason: string | undefined,
    context: AdminActionContext,
  ): Promise<AdminPayoutSummary> {
    return this.review(payoutId, PAYOUT_STATUSES.FAILED, ADMIN_ACTIONS.PAYOUT_FAILED, {
      reason,
      context,
    });
  }

  /**
   * Records the money as sent, consuming the lock.
   *
   * Two phases, and the order is load-bearing: the provider runs **before** the
   * transaction opens (§10.2, rule 1 — no external I/O inside one), and only
   * its confirmed reference is carried into it.
   */
  async settle(
    payoutId: string,
    externalReference: string,
    context: AdminActionContext,
  ): Promise<AdminPayoutSummary> {
    const reference = await this.payouts.execute(payoutId, externalReference);

    return this.review(payoutId, PAYOUT_STATUSES.PAID, ADMIN_ACTIONS.PAYOUT_SETTLED, {
      context,
      externalReference: reference,
    });
  }

  /**
   * One transition, one transaction: the status, the money it implies, and the
   * audit entry.
   *
   * DATABASE.md §10.1 gives approve, settle and reject/fail their own rows in
   * the boundary table, each pairing the status change with its money movement
   * and its audit entry. All three are this method.
   */
  private async review(
    payoutId: string,
    to: PayoutStatus,
    action: AdminAction,
    options: { reason?: string; externalReference?: string; context: AdminActionContext },
  ): Promise<AdminPayoutSummary> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.payouts.requireById(payoutId);

      const payout = await this.payouts.applyTransition(tx, payoutId, to, {
        adminId: options.context.adminId,
        reason: options.reason,
        externalReference: options.externalReference,
      });

      await this.audit.record(tx, {
        adminId: options.context.adminId,
        action,
        targetType: 'payout_request',
        targetId: payoutId,
        before: { status: before.status },
        after: {
          status: payout.status,
          amountPoints: payout.amountPoints,
          // The reference, never the destination: an audit trail holding the
          // secret it audits is a second copy of the secret (§16.4).
          externalReference: payout.externalReference,
        },
        reason: options.reason ?? null,
        ip: options.context.ip ?? null,
      });

      return payout;
    });

    this.logger.log({ payoutId, to, adminId: options.context.adminId }, 'Payout reviewed');

    return this.payouts.toAdminSummary(updated);
  }

  // --- Reads ----------------------------------------------------------------

  /**
   * The detail view, including the payment destination.
   *
   * The controller writes the audit entry for the read itself. Keeping it there
   * means the one thing that must always accompany this call is visible at the
   * surface that performs it, rather than buried in a method somebody could
   * later call from somewhere unaudited.
   */
  async detail(payout: PayoutRequest): Promise<AdminPayoutDetail> {
    return {
      ...this.payouts.toAdminSummary(payout),
      destination: payout.destination,
      reviewContext: await this.reviewContext(payout.userId),
    };
  }

  /**
   * What §11.3 says an admin sees alongside a request.
   *
   * *"The admin sees the account's fraud score, conversion history, chargeback
   * rate, account age, and any shared-device or shared-IP signals alongside the
   * request."*
   *
   * All of it is here. The fraud score arrived with the module that computes
   * it rather than as a number nothing stood behind, and the shared-device and
   * shared-IP signals come with it — those rules are exactly what
   * `rulesEverTriggered` records having fired.
   *
   * Composed entirely from other modules' services — `admin` reaches no table
   * but its own (§4.3, §5 rule 4).
   */
  private async reviewContext(userId: string): Promise<PayoutReviewContext> {
    const [user, balance, conversions, chargebacks, paidPayouts, fraud] = await Promise.all([
      this.users.requireById(userId),
      this.rewards.getBalance(userId),
      this.conversions.findMany({ userId, type: CONVERSION_TYPES.CONVERSION, limit: 1 }),
      this.conversions.findMany({ userId, status: CONVERSION_STATUSES.REVERSED, limit: 1 }),
      this.payouts.countPaidFor(userId),
      this.fraud.signalsFor(userId),
    ]);

    return {
      accountCreatedAt: user.createdAt.toISOString(),
      accountStatus: user.status,
      /*
       * All three buckets. A `locked` total larger than this request means
       * something else is also in flight, and an `available` balance that is
       * exactly the request is a different question than one far larger.
       */
      balance: {
        pending: balance.pending,
        available: balance.available,
        locked: balance.locked,
      },
      conversionCount: conversions.total,
      chargebackCount: chargebacks.total,
      paidPayoutCount: paidPayouts,
      /*
       * Null when nothing has ever been scored for this account, rather than a
       * zeroed summary. An admin reading `peakScore: 0` would reasonably
       * conclude the engine had looked and found nothing.
       */
      fraud: fraud.latestScore === null && fraud.flaggedCount === 0 ? null : fraud,
    };
  }
}
