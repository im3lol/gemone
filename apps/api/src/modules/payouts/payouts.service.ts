import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  PAYOUT_STATUSES,
  REWARD_ACTOR_TYPES,
  type AdminListPayoutsQuery,
  type AdminPayoutSummary,
  type ListPayoutsQuery,
  type Paginated,
  type PayoutOptions,
  type PayoutStatus,
  type PayoutSummary,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError, ValidationError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { PayoutRequest, Prisma } from '../../generated/prisma/client';
import { RewardAccountingService } from '../rewards/reward-accounting.service';
import { PAYOUT_PROVIDER, type PayoutProvider } from './contracts/payout-provider';
import { maskDestination, normalizeDestination } from './internal/destination';
import { assertTransition, lockEffectOf } from './internal/payout-state-machine';
import {
  PAYOUTS_CURRENCY,
  PAYOUTS_ENABLED_METHODS,
  PAYOUTS_MAXIMUM_POINTS,
  PAYOUTS_MAX_REQUESTS_PER_DAY,
  PAYOUTS_MINIMUM_POINTS,
  PAYOUTS_POINTS_PER_CURRENCY_UNIT,
} from './payouts.config';

export interface SubmitPayoutInput {
  userId: string;
  amountPoints: number;
  method: string;
  destination: string;
}

/** Everything an admin transition needs. The reason is mandatory where it matters. */
export interface ReviewInput {
  adminId: string;
  reason?: string;
  /** Set only when settling: the reference the money actually moved under. */
  externalReference?: string;
}

/**
 * Transitions that refuse without an explanation.
 *
 * Approval is not among them: it is the expected outcome and needs no defence,
 * while taking someone's withdrawal away from them does.
 */
const REASON_REQUIRED_FOR: ReadonlySet<PayoutStatus> = new Set([
  PAYOUT_STATUSES.REJECTED,
  PAYOUT_STATUSES.FAILED,
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Owner of `payout_requests` — the withdrawal state machine (§11).
 *
 * ## The one invariant
 *
 * **A request in a non-terminal state has exactly one live lock, and every
 * path to a terminal state resolves it exactly once.** A lock without a
 * request strands a user's points; a request without a lock allows
 * double-spending. Both halves are held by putting the lock and the row in the
 * same transaction (DATABASE.md §10.1) and by routing every transition through
 * a state machine that names the lock effect of each edge.
 *
 * ## Why locking happens at submission, not at approval
 *
 * §11.2 answers it: between submission and review there is a queue an admin
 * works through by hand. Without a lock, a user can submit, spend the same
 * points elsewhere, and have both succeed. Locking at submission makes
 * double-spending impossible without requiring the admin to be fast.
 *
 * ## Where the money actually is
 *
 * Nowhere in this file. Every point is reserved, consumed or returned through
 * `RewardAccountingService` (P2) — this module has never seen a balance row,
 * and `arch.spec.ts` fails the build if it tries.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardAccountingService,
    private readonly configuration: ConfigurationService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Options --------------------------------------------------------------

  /**
   * The rules the withdrawal form has to obey, for the person they constrain.
   *
   * All of it configuration this service already reads on every submission —
   * the same keys, resolved the same way. Nothing is computed here, which is
   * the point: a form that derived the minimum or the rate for itself would be
   * a second copy of a rule an admin thinks they changed in one place.
   *
   * **Methods are filtered by what can actually settle them.** `submit`
   * refuses a method the installed provider does not support, so listing one
   * here would put a choice in a dropdown that the next click rejects. The
   * manual provider supports everything, so today this removes nothing — it is
   * the seam holding the day an automated provider handles some methods and
   * not others.
   */
  async options(): Promise<PayoutOptions> {
    const [methods, minimumPoints, maximumPoints, pointsPerCurrencyUnit, currency] =
      await Promise.all([
        this.configuration.get<string[]>(PAYOUTS_ENABLED_METHODS.key),
        this.configuration.get<number>(PAYOUTS_MINIMUM_POINTS.key),
        this.configuration.get<number>(PAYOUTS_MAXIMUM_POINTS.key),
        this.configuration.get<number>(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key),
        this.configuration.get<string>(PAYOUTS_CURRENCY.key),
      ]);

    return {
      methods: methods.filter((method) => this.provider.supports(method)),
      minimumPoints,
      maximumPoints,
      pointsPerCurrencyUnit,
      currency,
    };
  }

  // --- Submission -----------------------------------------------------------

  /**
   * Submits a withdrawal — §11.2.
   *
   * The ordering follows that section exactly: validate the amount against
   * configuration, validate the destination for the chosen method, lock, and
   * create the request in the same transaction as the lock.
   *
   * Everything that can refuse, refuses **before** the transaction opens. A
   * configuration read or a daily-cap count inside it would hold the balance
   * row locked for the duration (§10.2, rule 4).
   */
  async submit(input: SubmitPayoutInput): Promise<PayoutSummary> {
    const [minimum, maximum, methods, pointsPerUnit, currency, dailyCap] = await Promise.all([
      this.configuration.get<number>(PAYOUTS_MINIMUM_POINTS.key),
      this.configuration.get<number>(PAYOUTS_MAXIMUM_POINTS.key),
      this.configuration.get<string[]>(PAYOUTS_ENABLED_METHODS.key),
      this.configuration.get<number>(PAYOUTS_POINTS_PER_CURRENCY_UNIT.key),
      this.configuration.get<string>(PAYOUTS_CURRENCY.key),
      this.configuration.get<number>(PAYOUTS_MAX_REQUESTS_PER_DAY.key),
    ]);

    const method = input.method.trim().toLowerCase();

    if (!methods.includes(method)) {
      throw new DomainError(
        ERROR_CODES.PAYOUT_METHOD_UNSUPPORTED,
        `"${method}" is not an available payout method`,
        422,
        { method, available: methods },
      );
    }

    if (!this.provider.supports(method)) {
      /*
       * Asked even though the manual provider says yes to everything. The
       * check is the seam doing its job: the day an automated provider handles
       * some methods and not others, this refuses with a reason instead of
       * accepting a request nothing can execute.
       */
      throw new DomainError(
        ERROR_CODES.PAYOUT_METHOD_UNSUPPORTED,
        `No payout provider can settle "${method}"`,
        422,
        { method, provider: this.provider.name },
      );
    }

    if (
      !Number.isInteger(input.amountPoints) ||
      input.amountPoints < minimum ||
      input.amountPoints > maximum
    ) {
      throw new DomainError(
        ERROR_CODES.PAYOUT_AMOUNT_OUT_OF_RANGE,
        `A withdrawal must be between ${minimum} and ${maximum} points`,
        422,
        { requested: input.amountPoints, minimum, maximum },
      );
    }

    const destination = normalizeDestination(input.destination);

    await this.assertWithinDailyCap(input.userId, dailyCap);

    const now = this.clock.now();
    const payoutId = uuidv7();

    /*
     * The transaction DATABASE.md §10.1 names: "Lock points → create payout
     * request. A lock without a request strands points; a request without a
     * lock allows double-spend."
     *
     * The lock goes first, which is also §10.2 rule 3's fixed order — the
     * balance row is locked before anything else this operation touches. It is
     * the step that can refuse (insufficient available points), so failing here
     * costs nothing.
     */
    const created = await this.prisma.$transaction(async (tx) => {
      // The method travels with the points (D85), so `/earnings` can say
      // "Withdrawal requested · paypal" months after `paypal` stopped being
      // one of the enabled methods.
      const lock = await this.rewards.lock(
        input.userId,
        input.amountPoints,
        payoutId,
        { label: method },
        tx,
      );

      return tx.payoutRequest.create({
        data: {
          id: payoutId,
          userId: input.userId,
          status: PAYOUT_STATUSES.PENDING_REVIEW,
          amountPoints: input.amountPoints,
          cashAmountMinor: toCashMinor(input.amountPoints, pointsPerUnit),
          cashCurrency: currency,
          pointsPerCurrencyUnit: pointsPerUnit,
          method,
          destination,
          lockTransactionId: lock.id,
          createdAt: now,
        },
      });
    });

    // The destination is never in this line, or in any other (§16.4).
    this.logger.log(
      {
        payoutId: created.id,
        userId: input.userId,
        amountPoints: created.amountPoints,
        method: created.method,
      },
      'Withdrawal requested',
    );

    return this.toSummary(created);
  }

  // --- Review ---------------------------------------------------------------

  /**
   * Applies one transition **inside a transaction the caller owns**.
   *
   * The caller is `admin`, and it owns the transaction for the same reason it
   * does for every other administrative action in this codebase: the audit
   * entry belongs in the same transaction as the action it records (§10.2,
   * rule 5), and `AdminAuditService` is the `admin` module's. Inverting it —
   * having this service reach for the audit trail — would make `payouts`
   * import `admin` while `admin` imports `payouts`, a cycle with no real
   * second direction behind it (DECISIONS.md D44).
   *
   * What stays here is everything that decides what a transition *means*: the
   * state machine, the lock effect, and the row. `admin` supplies who did it.
   */
  async applyTransition(
    tx: PrismaTransactionClient,
    payoutId: string,
    to: PayoutStatus,
    review: ReviewInput,
  ): Promise<PayoutRequest> {
    const reason = review.reason?.trim() ?? '';

    if (REASON_REQUIRED_FOR.has(to) && reason.length === 0) {
      /*
       * Refusing someone's money without saying why is the support ticket this
       * field exists to prevent — and the user is shown this text.
       *
       * A `ValidationError`, not a `DomainError`: the transition itself is
       * permitted and the request is simply missing a field, which is the
       * distinction §15.1 draws. Reusing `PAYOUT_INVALID_TRANSITION` here would
       * tell a client "this request is in the wrong state" when the truth is
       * "you left a box empty" — two different fixes behind one code.
       */
      throw new ValidationError(
        `A reason is required to mark a payout ${to.toLowerCase()}`,
        [{ field: 'reason', message: 'must be provided' }],
        { payoutId, to },
      );
    }

    /*
     * Re-read inside the transaction, and locked.
     *
     * Two admins clicking approve in the same second both read
     * `PENDING_REVIEW` outside a transaction and both pass the state check —
     * and the second settle would consume a lock that was already consumed.
     * `FOR UPDATE` on the request row serialises them, so the loser sees
     * `APPROVED` and the machine refuses it.
     */
    const locked = await tx.$queryRaw<{ status: PayoutStatus }[]>`
      SELECT status FROM payout_requests WHERE id = ${payoutId}::uuid FOR UPDATE`;

    const current = locked[0];
    if (!current) throw payoutNotFound(payoutId);

    assertTransition(current.status, to, payoutId);

    const payout = await tx.payoutRequest.findUniqueOrThrow({ where: { id: payoutId } });
    const effect = lockEffectOf(current.status, to);

    /*
     * The money, through the one service allowed to move it (P2), inside this
     * transaction — so a status and the points behind it can never disagree.
     */
    if (effect === 'settle') {
      await this.rewards.settleLock(
        payout.lockTransactionId,
        reason || 'withdrawal paid',
        { actor: { type: REWARD_ACTOR_TYPES.ADMIN, id: review.adminId } },
        tx,
      );
    } else if (effect === 'release') {
      await this.rewards.releaseLock(
        payout.lockTransactionId,
        reason || `withdrawal ${to.toLowerCase()}`,
        { actor: { type: REWARD_ACTOR_TYPES.ADMIN, id: review.adminId } },
        tx,
      );
    }

    const now = this.clock.now();

    const updated = await tx.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: to,
        reviewedByAdminId: review.adminId,
        reviewedAt: now,
        ...(reason.length > 0 ? { reviewReason: reason } : {}),
        ...(to === PAYOUT_STATUSES.PAID
          ? { settledAt: now, externalReference: review.externalReference ?? null }
          : {}),
      },
    });

    this.logger.log(
      {
        payoutId,
        from: current.status,
        to,
        adminId: review.adminId,
        amountPoints: updated.amountPoints,
        lockEffect: effect,
      },
      'Payout status changed',
    );

    return updated;
  }

  /**
   * Runs the payment, **outside any transaction** (§10.2, rule 1).
   *
   * For the manual provider this is a formality — a human already sent the
   * money and handed us the reference. For an automated one it is a network
   * round trip, and holding a balance row locked across it would be holding a
   * lock across the slowest thing in the system.
   *
   * The state is checked first, so a request in the wrong state never reaches
   * something that could move money. It is checked *again* under the row lock
   * in `applyTransition`, because this check is outside a transaction and two
   * settles could otherwise both pass it.
   */
  async execute(payoutId: string, externalReference: string): Promise<string> {
    const payout = await this.requireById(payoutId);

    assertTransition(payout.status, PAYOUT_STATUSES.PAID, payout.id);

    const execution = await this.provider.execute({
      payoutId: payout.id,
      userId: payout.userId,
      amountMinor: payout.cashAmountMinor,
      currency: payout.cashCurrency,
      method: payout.method,
      destination: payout.destination,
      externalReference,
    });

    if (!execution.settled) {
      /*
       * The provider refused. The request stays `APPROVED` with its lock
       * intact — deliberately *not* moved to `FAILED`, because failing is an
       * admin's decision about whether to retry or give up, and this is only
       * the report that one attempt did not work.
       */
      throw new DomainError(
        ERROR_CODES.PAYOUT_INVALID_TRANSITION,
        `The payout could not be settled: ${execution.reason}`,
        409,
        { payoutId, provider: this.provider.name },
      );
    }

    return execution.externalReference;
  }

  // --- Reads ----------------------------------------------------------------

  async findManyForUser(
    userId: string,
    query: ListPayoutsQuery,
  ): Promise<Paginated<PayoutRequest>> {
    return this.findMany({ ...query, userId });
  }

  async findMany(query: AdminListPayoutsQuery): Promise<Paginated<PayoutRequest>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.PayoutRequestWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where,
        /*
         * Oldest first when reviewing a queue, newest first otherwise. The
         * queue is worked through in the order people joined it — a payout
         * that sorts to the bottom of an admin's screen is a payout that waits
         * until somebody complains.
         */
        orderBy: {
          createdAt: query.status === PAYOUT_STATUSES.PENDING_REVIEW ? 'asc' : 'desc',
        },
        take: limit,
        skip: offset,
      }),
      this.prisma.payoutRequest.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async requireById(id: string): Promise<PayoutRequest> {
    const payout = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!payout) throw payoutNotFound(id);
    return payout;
  }

  /** Scoped to an owner, for the user-facing surface. Ownership is not a filter. */
  async requireOwnedBy(id: string, userId: string): Promise<PayoutRequest> {
    const payout = await this.requireById(id);

    if (payout.userId !== userId) {
      // The same error as "not found", deliberately: telling a caller that a
      // payout exists but is not theirs confirms the id.
      throw payoutNotFound(id);
    }

    return payout;
  }

  async countPaidFor(userId: string): Promise<number> {
    return this.prisma.payoutRequest.count({
      where: { userId, status: PAYOUT_STATUSES.PAID },
    });
  }

  // --- Serialisation --------------------------------------------------------

  /** The owner's view. The destination is masked; nothing else is hidden. */
  toSummary(payout: PayoutRequest): PayoutSummary {
    return {
      id: payout.id,
      status: payout.status,
      amountPoints: payout.amountPoints,
      cashAmountMinor: payout.cashAmountMinor,
      cashCurrency: payout.cashCurrency,
      method: payout.method,
      destinationMasked: maskDestination(payout.destination),
      reviewReason: payout.reviewReason,
      createdAt: payout.createdAt.toISOString(),
      reviewedAt: payout.reviewedAt?.toISOString() ?? null,
      settledAt: payout.settledAt?.toISOString() ?? null,
    };
  }

  /**
   * The admin list view. **No destination at all** — DATABASE.md §3.5 puts it
   * on the detail view only, and the detail view is audited.
   */
  toAdminSummary(payout: PayoutRequest): AdminPayoutSummary {
    return {
      id: payout.id,
      userId: payout.userId,
      status: payout.status,
      amountPoints: payout.amountPoints,
      cashAmountMinor: payout.cashAmountMinor,
      cashCurrency: payout.cashCurrency,
      pointsPerCurrencyUnit: payout.pointsPerCurrencyUnit,
      method: payout.method,
      reviewedByAdminId: payout.reviewedByAdminId,
      reviewedAt: payout.reviewedAt?.toISOString() ?? null,
      reviewReason: payout.reviewReason,
      externalReference: payout.externalReference,
      settledAt: payout.settledAt?.toISOString() ?? null,
      createdAt: payout.createdAt.toISOString(),
      updatedAt: payout.updatedAt.toISOString(),
    };
  }

  // --- Internals ------------------------------------------------------------

  /**
   * The daily request cap (P3).
   *
   * A rolling 24 hours rather than a calendar day, so the limit does not reset
   * at a moment an attacker can wait for. Counted from the table this module
   * owns, over an index that exists for it.
   *
   * Checked before the transaction and therefore racy in the same way the click
   * limit is: two requests in the same instant can both pass. Accepted for the
   * same reason — it bounds sustained behaviour, not an accounting invariant,
   * and the *money* is protected by the balance lock regardless. A user cannot
   * withdraw more than they have however many requests they submit.
   */
  private async assertWithinDailyCap(userId: string, cap: number): Promise<void> {
    const since = new Date(this.clock.nowMs() - DAY_MS);

    const recent = await this.prisma.payoutRequest.count({
      where: { userId, createdAt: { gte: since } },
    });

    if (recent >= cap) {
      this.logger.warn({ userId, recent, cap }, 'Payout daily request cap reached');

      throw new DomainError(
        ERROR_CODES.PAYOUT_DAILY_LIMIT_REACHED,
        'You have reached the daily limit for withdrawal requests',
        429,
        { cap },
      );
    }
  }
}

function payoutNotFound(id: string): DomainError {
  return new DomainError(ERROR_CODES.PAYOUT_NOT_FOUND, 'Payout request not found', 404, {
    id,
  });
}

/**
 * Points to money, in minor units.
 *
 * Integer arithmetic, rounding **down**: a fractional cent that rounded up
 * would pay a fraction of a cent nobody earned, and doing that on every payout
 * is a slow leak with no record. The remainder stays as points the user keeps.
 */
export function toCashMinor(amountPoints: number, pointsPerCurrencyUnit: number): number {
  return Math.floor((amountPoints * 100) / pointsPerCurrencyUnit);
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

export const __testing = { toCashMinor, clampLimit, DAY_MS, DEFAULT_LIMIT, MAX_LIMIT };
