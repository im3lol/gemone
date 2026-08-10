import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  REWARD_ACTOR_TYPES,
  REWARD_SOURCE_TYPES,
  REWARD_TRANSACTION_TYPES,
  type AdminRewardHistoryQuery,
  type Balance,
  type BalanceReconciliation,
  type Paginated,
  type RewardActorType,
  type RewardSourceType,
  type RewardTransactionRecord,
  type RewardTransactionType,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError, ValidationError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { RewardTransaction, UserBalance } from '../../generated/prisma/client';
import { REWARDS_HOLD_PERIOD_DAYS } from './rewards.config';

/** Who is asking. Recorded on every movement, never inferred. */
export interface RewardActor {
  type: RewardActorType;
  id?: string | null;
}

/** What a movement is about. Polymorphic — see the column comment. */
export interface RewardSource {
  type: RewardSourceType;
  id?: string | null;
}

export interface CreditInput {
  userId: string;
  amountPoints: number;
  source: RewardSource;
  actor?: RewardActor;
  reason?: string;
  /**
   * Scopes the hold-period lookup (P3, PROVIDER → GLOBAL). Omit for a credit
   * with no provider behind it, such as a bonus.
   */
  holdScopeProviderId?: string | null;
  /**
   * Credits without a maturity date, so the points sit in `pending` until a
   * human releases them. This is how §10.3 step 7's hold is expressed: the
   * points exist and are visible, and no clock will ever make them
   * withdrawable.
   */
  holdIndefinitely?: boolean;
  type?: typeof REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT | typeof REWARD_TRANSACTION_TYPES.BONUS;
}

export interface DebitInput {
  userId: string;
  amountPoints: number;
  source: RewardSource;
  actor?: RewardActor;
  reason?: string;
}

/** Every mutation runs against this: either the pool, or a caller's transaction. */
type Client = PrismaTransactionClient | PrismaService;

/**
 * The sole owner of balance state — P2, ARCHITECTURE.md §9.1.
 *
 * **Nothing else in the system mutates a balance.** Not conversion crediting,
 * not chargebacks, not payouts, not fraud holds, not admin adjustments — every
 * one of them calls this interface and nothing else. `arch.spec.ts` enforces
 * that mechanically, because ARCHITECTURE.md §4.4 calls it the single most
 * important rule in the codebase.
 *
 * ## What this class is, and what it is not
 *
 * It is an *implementation* of an interface whose shape is the deliverable
 * (PROJECT.md §4.5). The mutable `user_balances` row is the simplest thing
 * that works; the append-only ledger remains available behind these method
 * signatures, and `reward_transactions` is already exactly what such an
 * implementation would replay to become authoritative.
 *
 * ## The three rules every mutation obeys
 *
 *  1. **One database transaction.** Never two, never none.
 *  2. **The balance row is locked first, always** (`SELECT ... FOR UPDATE`,
 *     §9.5 and §10.2 rule 3). Pessimistic, not optimistic: contention on one
 *     user's balance is rare, so lock waits are negligible — but a lost update
 *     here is money, and optimistic concurrency means getting a retry path
 *     right at every call site instead of once here.
 *  3. **The history row and the balance update are written together.** A
 *     balance that moved without a transaction behind it is drift, and drift
 *     is the signal PROJECT.md R5 says should trigger the ledger migration.
 *
 * ## Why the buckets are recorded as three signed deltas
 *
 * Because their sums over a user's history **are** that user's balance. That
 * makes reconciliation a sum rather than a simulation, and it is what makes
 * the ledger migration a replay rather than a rewrite.
 */
@Injectable()
export class RewardAccountingService {
  private readonly logger = new Logger(RewardAccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Creates a user's balance row, at zero.
   *
   * Called by `users` inside the registration transaction (DATABASE.md §10.1),
   * so a balance is never absent. The row is created here, by this service,
   * rather than by the module that owns `users` — P2's access rule has no
   * exception for "it is only an insert", and an exception granted once is an
   * exception someone extends.
   *
   * Idempotent, so a re-run of a partially failed registration is not an error.
   */
  async openAccount(userId: string, client: Client = this.prisma): Promise<void> {
    await client.userBalance.createMany({
      data: [{ id: uuidv7(), userId }],
      skipDuplicates: true,
    });
  }

  // --- Mutations ------------------------------------------------------------

  /**
   * Credits points. They land in `pending` (§9.3).
   *
   * The hold period is resolved **before** the transaction opens (§10.2 rule
   * 4) — a configuration read inside one would hold the balance lock open for
   * the duration of a cache miss — and the resolved value is stored on the
   * transaction, never re-read afterwards (§9.4).
   */
  async credit(input: CreditInput, client?: Client): Promise<RewardTransactionRecord> {
    const amount = requirePositive(input.amountPoints);
    const now = this.clock.now();

    let holdPeriodDays: number | null = null;
    let maturesAt: Date | null = null;

    if (!input.holdIndefinitely) {
      holdPeriodDays = await this.configuration.get<number>(
        REWARDS_HOLD_PERIOD_DAYS.key,
        input.holdScopeProviderId ?? undefined,
      );
      maturesAt = new Date(now.getTime() + holdPeriodDays * 24 * 60 * 60 * 1000);
    }

    return this.mutate(
      {
        userId: input.userId,
        type: input.type ?? REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
        amountPoints: amount,
        pendingDelta: amount,
        availableDelta: 0,
        lockedDelta: 0,
        source: input.source,
        actor: input.actor ?? { type: REWARD_ACTOR_TYPES.SYSTEM },
        reason: input.reason ?? null,
        maturesAt,
        holdPeriodDays,
        lifetime: { earned: amount },
        at: now,
      },
      client,
    );
  }

  /**
   * Takes points away, without a specific transaction to point at.
   *
   * Used for manual adjustments. A chargeback is `reverse()` instead, because
   * it *does* have something to point at and the link is what makes the
   * history explainable.
   */
  async debit(input: DebitInput, client?: Client): Promise<RewardTransactionRecord> {
    const amount = requirePositive(input.amountPoints);

    return this.mutate(
      {
        userId: input.userId,
        type: REWARD_TRANSACTION_TYPES.MANUAL_ADJUSTMENT,
        amountPoints: -amount,
        // Taken from `available` — the only bucket an adjustment may touch.
        // Reaching into `locked` would silently unfund a payout an admin is
        // about to send, and into `pending` would undo a hold nobody asked to
        // undo.
        pendingDelta: 0,
        availableDelta: -amount,
        lockedDelta: 0,
        source: input.source,
        actor: input.actor ?? { type: REWARD_ACTOR_TYPES.ADMIN },
        reason: input.reason ?? null,
        maturesAt: null,
        holdPeriodDays: null,
        lifetime: {},
        at: this.clock.now(),
      },
      client,
    );
  }

  /**
   * Reverses an earlier credit — a chargeback.
   *
   * **Takes from `pending` first, then `available`, and is allowed to drive
   * the balance negative** (§9.5). A clamped balance is a silently lost debt:
   * the money left, the record says it did not, and the next credit quietly
   * pays off a debt nobody can see. Negative balances are surfaced to admins
   * rather than hidden.
   *
   * `locked` is never touched. Those points are reserved for a payout an admin
   * may be in the middle of sending, and taking them back under it would make
   * the payout unfunded without the payout knowing.
   */
  async reverse(
    transactionId: string,
    reason: string,
    options: { actor?: RewardActor; source?: RewardSource } = {},
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    const run = async (tx: PrismaTransactionClient) => {
      const original = await tx.rewardTransaction.findUnique({ where: { id: transactionId } });

      if (!original) {
        throw new DomainError(
          ERROR_CODES.REWARD_TRANSACTION_NOT_FOUND,
          'No reward transaction with that reference',
          404,
          { transactionId },
        );
      }

      if (original.amountPoints <= 0) {
        // Only something that added points can be taken back. Reversing a
        // debit would be a credit, and a credit dressed as a reversal is how
        // an adjustment ends up with no reason attached to it.
        throw new DomainError(
          ERROR_CODES.REWARD_INVALID_OPERATION,
          'Only a credit can be reversed',
          409,
          { transactionId, type: original.type },
        );
      }

      const alreadyReversed = await tx.rewardTransaction.findFirst({
        where: {
          sourceTransactionId: original.id,
          type: REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT,
        },
      });

      if (alreadyReversed) {
        // Reversing twice would take the points away twice. The check is inside
        // the transaction, after the balance lock, so two concurrent chargebacks
        // for one conversion cannot both pass it.
        throw new DomainError(
          ERROR_CODES.REWARD_INVALID_OPERATION,
          'This credit has already been reversed',
          409,
          { transactionId },
        );
      }

      const balance = await this.lockBalance(tx, original.userId);
      const amount = original.amountPoints;

      // Prefers pending: those points were never withdrawable, so taking them
      // back costs the user nothing they had been promised was theirs.
      const fromPending = Math.min(balance.pendingPoints, amount);
      const fromAvailable = amount - fromPending;

      return this.write(
        tx,
        {
          userId: original.userId,
          type: REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT,
          amountPoints: -amount,
          pendingDelta: -fromPending,
          availableDelta: -fromAvailable,
          lockedDelta: 0,
          source: options.source ?? { type: REWARD_SOURCE_TYPES.SYSTEM },
          sourceTransactionId: original.id,
          actor: options.actor ?? { type: REWARD_ACTOR_TYPES.SYSTEM },
          reason,
          maturesAt: null,
          holdPeriodDays: null,
          lifetime: { reversed: amount },
          at: this.clock.now(),
        },
        balance,
      );
    };

    return client ? run(client as PrismaTransactionClient) : this.prisma.$transaction(run);
  }

  /**
   * Moves matured points from `pending` to `available`.
   *
   * Written as a transaction row rather than as a flag on the credit, which is
   * what keeps `reward_transactions` append-only *and* keeps reconciliation a
   * sum. "Has this credit matured?" is answered by the existence of this row.
   *
   * Idempotent by construction: a second call finds the maturation row and
   * does nothing. That matters because a job may always run twice (§12.2).
   */
  async mature(creditId: string, client?: Client): Promise<RewardTransactionRecord | null> {
    const run = async (tx: PrismaTransactionClient) => {
      const credit = await tx.rewardTransaction.findUnique({ where: { id: creditId } });
      if (!credit) return null;

      const acted = await tx.rewardTransaction.findFirst({
        where: {
          sourceTransactionId: credit.id,
          type: {
            in: [
              REWARD_TRANSACTION_TYPES.REWARD_MATURATION,
              REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT,
            ],
          },
        },
      });

      // Already matured, or charged back before it could — either way its
      // points are no longer in `pending` and moving them again would invent
      // available points out of nothing.
      if (acted) return null;

      const balance = await this.lockBalance(tx, credit.userId);

      return this.write(
        tx,
        {
          userId: credit.userId,
          type: REWARD_TRANSACTION_TYPES.REWARD_MATURATION,
          // Zero: nothing was earned or lost, points changed bucket.
          amountPoints: 0,
          pendingDelta: -credit.amountPoints,
          availableDelta: credit.amountPoints,
          lockedDelta: 0,
          source: { type: REWARD_SOURCE_TYPES.SYSTEM },
          sourceTransactionId: credit.id,
          actor: { type: REWARD_ACTOR_TYPES.SYSTEM },
          reason: 'hold period elapsed',
          maturesAt: null,
          holdPeriodDays: null,
          lifetime: {},
          at: this.clock.now(),
        },
        balance,
      );
    };

    return client ? run(client as PrismaTransactionClient) : this.prisma.$transaction(run);
  }

  /**
   * Reserves points for an in-flight payout: `available` → `locked`.
   *
   * **Only `available` is lockable** (§11.2). `pending` points are inside their
   * hold period and `locked` points are already spoken for; a withdrawal that
   * could reach either would be paying out money that has not settled.
   *
   * This is the one operation that refuses on insufficient funds, because it is
   * the only one where the user is asking for something rather than being told
   * something happened.
   */
  async lock(
    userId: string,
    amountPoints: number,
    payoutId: string,
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    const amount = requirePositive(amountPoints);

    const run = async (tx: PrismaTransactionClient) => {
      const balance = await this.lockBalance(tx, userId);

      if (balance.availablePoints < amount) {
        throw new DomainError(
          ERROR_CODES.REWARD_INSUFFICIENT_BALANCE,
          'Not enough available points',
          409,
          { userId, requested: amount, available: balance.availablePoints },
        );
      }

      return this.write(
        tx,
        {
          userId,
          type: REWARD_TRANSACTION_TYPES.PAYOUT_LOCK,
          amountPoints: 0,
          pendingDelta: 0,
          availableDelta: -amount,
          lockedDelta: amount,
          source: { type: REWARD_SOURCE_TYPES.PAYOUT, id: payoutId },
          sourceTransactionId: null,
          actor: { type: REWARD_ACTOR_TYPES.USER, id: userId },
          reason: 'withdrawal requested',
          maturesAt: null,
          holdPeriodDays: null,
          lifetime: {},
          at: this.clock.now(),
        },
        balance,
      );
    };

    return client ? run(client as PrismaTransactionClient) : this.prisma.$transaction(run);
  }

  /** Returns a lock to `available` — a rejected or failed payout (§11.3). */
  async releaseLock(
    lockTransactionId: string,
    reason: string,
    options: { actor?: RewardActor } = {},
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    return this.resolveLock(
      lockTransactionId,
      REWARD_TRANSACTION_TYPES.PAYOUT_REFUND,
      reason,
      options,
      client,
    );
  }

  /**
   * Consumes a lock — the payout was actually sent (§11.3).
   *
   * Separate from approval on purpose: the external payment happens between
   * them, and collapsing the two would mark money paid before it was.
   */
  async settleLock(
    lockTransactionId: string,
    reason: string,
    options: { actor?: RewardActor } = {},
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    return this.resolveLock(
      lockTransactionId,
      REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE,
      reason,
      options,
      client,
    );
  }

  // --- Reads ----------------------------------------------------------------

  /**
   * The three buckets, never one number.
   *
   * Returns zeros for a user with no balance row rather than throwing. The row
   * is created with the user so this should not happen — and a read that
   * throws would turn a missing row into a broken profile page rather than a
   * balance of nothing, which is what it is.
   */
  async getBalance(userId: string): Promise<Balance> {
    const row = await this.prisma.userBalance.findUnique({ where: { userId } });
    return toBalance(row);
  }

  async getHistory(
    userId: string,
    query: { type?: RewardTransactionType; limit?: number; offset?: number } = {},
  ): Promise<Paginated<RewardTransactionRecord>> {
    return this.findMany({ ...query, userId });
  }

  async findMany(
    query: AdminRewardHistoryQuery,
  ): Promise<Paginated<RewardTransactionRecord>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.rewardTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.rewardTransaction.count({ where }),
    ]);

    return { items: items.map(toRecord), total, limit, offset };
  }

  /** The movement a given source caused, if it caused one. */
  async findBySource(
    sourceType: RewardSourceType,
    sourceId: string,
    type?: RewardTransactionType,
  ): Promise<RewardTransactionRecord | null> {
    const row = await this.prisma.rewardTransaction.findFirst({
      where: { sourceType, sourceId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'asc' },
    });

    return row ? toRecord(row) : null;
  }

  /**
   * Credits whose hold has elapsed and which nothing has acted on yet.
   *
   * Bounded, and re-run until it returns nothing (§12.2 rule 2). `maturesAt`
   * null is excluded by the comparison itself, which is exactly what an
   * indefinite hold means.
   */
  async findMaturable(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.rewardTransaction.findMany({
      where: {
        type: {
          in: [
            REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
            REWARD_TRANSACTION_TYPES.BONUS,
          ],
        },
        maturesAt: { lte: now },
        actedOnBy: {
          none: {
            type: {
              in: [
                REWARD_TRANSACTION_TYPES.REWARD_MATURATION,
                REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT,
              ],
            },
          },
        },
      },
      select: { id: true },
      orderBy: { maturesAt: 'asc' },
      take: limit,
    });

    return rows.map((row) => row.id);
  }

  /**
   * One page of users to reconcile, ordered by a unique key.
   *
   * Lives here rather than in the job because P2 admits no exception for
   * reads: `arch.spec.ts` fails the build on `prisma.userBalance` anywhere
   * outside this folder, and a sweep that paged the table itself would be the
   * first crack in the rule the whole reward design rests on.
   *
   * **Paged by `userId`, which is unique on this table.** A non-unique cursor
   * repeats and skips rows across pages, which on this sweep would mean
   * silently never checking some balances — a reconciliation job with a blind
   * spot is worse than none, because it reports "all clear" for accounts it
   * never looked at.
   *
   * Iterating `user_balances` is what makes the sweep complete: `openAccount`
   * runs inside the registration transaction (DATABASE.md §10.1), so a user
   * without a balance row does not exist.
   */
  async findUsersToReconcile(after: string | null, limit: number): Promise<string[]> {
    const rows = await this.prisma.userBalance.findMany({
      where: after === null ? {} : { userId: { gt: after } },
      select: { userId: true },
      orderBy: { userId: 'asc' },
      take: limit,
    });

    return rows.map((row) => row.userId);
  }

  /**
   * Checks a balance against its own history — PROJECT.md R4's last mitigation.
   *
   * **Reports; never repairs.** R5 is explicit: "If reconciliation reports any
   * unexplained drift in production, that is the signal to migrate — not a bug
   * to patch." Silently correcting the row would destroy the only evidence that
   * the simple balance model had failed, which is the evidence the P2 decision
   * is supposed to be made on.
   *
   * **One snapshot, or the comparison is meaningless.** The balance and the
   * history it is checked against must be read as of the same instant. Read
   * separately under READ COMMITTED they are not: each statement takes its own
   * snapshot, so a credit committing between them is counted on one side and
   * not the other, and this method reports drift on a ledger that is perfectly
   * consistent. That is not theoretical — with writes landing concurrently it
   * reproduced at roughly 2% of reads, always by exactly the amount of one
   * in-flight movement.
   *
   * `RepeatableRead` rather than `Serializable`: all this needs is that its own
   * reads agree with each other, which is exactly what a stable snapshot gives.
   * Serializable would add predicate locks and a serialization-failure retry
   * path to a transaction that writes nothing.
   *
   * **Still read-only, and still lock-free.** Nothing in here takes a row lock;
   * concurrent credits, debits and payouts proceed untouched while it runs. A
   * reader that blocked writers would be a reconciliation job that costs the
   * platform money to run.
   */
  async reconcile(userId: string): Promise<BalanceReconciliation> {
    const [row, sums, transactionCount] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.userBalance.findUnique({ where: { userId } }),
          tx.rewardTransaction.aggregate({
            where: { userId },
            _sum: { pendingDelta: true, availableDelta: true, lockedDelta: true },
          }),
          tx.rewardTransaction.count({ where: { userId } }),
        ]),
      { isolationLevel: 'RepeatableRead' },
    );

    const recorded = {
      pending: row?.pendingPoints ?? 0,
      available: row?.availablePoints ?? 0,
      locked: row?.lockedPoints ?? 0,
    };

    const expected = {
      pending: sums._sum.pendingDelta ?? 0,
      available: sums._sum.availableDelta ?? 0,
      locked: sums._sum.lockedDelta ?? 0,
    };

    const drift = {
      pending: recorded.pending - expected.pending,
      available: recorded.available - expected.available,
      locked: recorded.locked - expected.locked,
    };

    const balanced = drift.pending === 0 && drift.available === 0 && drift.locked === 0;

    if (!balanced) {
      // Loud, and at `error`. A balance that cannot be explained by its own
      // history is the failure this whole design is arranged to detect.
      this.logger.error({ userId, recorded, expected, drift }, 'Balance drift detected');
    }

    return { userId, balanced, recorded, expected, drift, transactionCount };
  }

  // --- Internals ------------------------------------------------------------

  private async resolveLock(
    lockTransactionId: string,
    type:
      | typeof REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE
      | typeof REWARD_TRANSACTION_TYPES.PAYOUT_REFUND,
    reason: string,
    options: { actor?: RewardActor },
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    const run = async (tx: PrismaTransactionClient) => {
      const lockRow = await tx.rewardTransaction.findUnique({
        where: { id: lockTransactionId },
      });

      if (!lockRow || lockRow.type !== REWARD_TRANSACTION_TYPES.PAYOUT_LOCK) {
        throw new DomainError(
          ERROR_CODES.REWARD_TRANSACTION_NOT_FOUND,
          'No payout lock with that reference',
          404,
          { lockTransactionId },
        );
      }

      const resolved = await tx.rewardTransaction.findFirst({
        where: {
          sourceTransactionId: lockRow.id,
          type: {
            in: [
              REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE,
              REWARD_TRANSACTION_TYPES.PAYOUT_REFUND,
            ],
          },
        },
      });

      if (resolved) {
        // Settling twice consumes points that were only ever reserved once;
        // refunding twice invents them. Both are money.
        throw new DomainError(
          ERROR_CODES.REWARD_INVALID_OPERATION,
          'This payout lock has already been resolved',
          409,
          { lockTransactionId, resolvedAs: resolved.type },
        );
      }

      const balance = await this.lockBalance(tx, lockRow.userId);
      const amount = lockRow.lockedDelta;
      const settling = type === REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE;

      return this.write(
        tx,
        {
          userId: lockRow.userId,
          type,
          // A settle is where points actually leave the user; a refund moves
          // them back and costs nothing.
          amountPoints: settling ? -amount : 0,
          pendingDelta: 0,
          availableDelta: settling ? 0 : amount,
          lockedDelta: -amount,
          source: { type: REWARD_SOURCE_TYPES.PAYOUT, id: lockRow.sourceId },
          sourceTransactionId: lockRow.id,
          actor: options.actor ?? { type: REWARD_ACTOR_TYPES.SYSTEM },
          reason,
          maturesAt: null,
          holdPeriodDays: null,
          lifetime: settling ? { withdrawn: amount } : {},
          at: this.clock.now(),
        },
        balance,
      );
    };

    return client ? run(client as PrismaTransactionClient) : this.prisma.$transaction(run);
  }

  /**
   * Opens the transaction if the caller did not, then writes.
   *
   * A caller that already has one — conversion processing, payout submission —
   * passes it in, so the credit and whatever caused it commit together or not
   * at all (DATABASE.md §10.1).
   */
  private async mutate(
    movement: Movement,
    client?: Client,
  ): Promise<RewardTransactionRecord> {
    const run = async (tx: PrismaTransactionClient) => {
      const balance = await this.lockBalance(tx, movement.userId);
      return this.write(tx, { ...movement, sourceTransactionId: null }, balance);
    };

    return client ? run(client as PrismaTransactionClient) : this.prisma.$transaction(run);
  }

  /**
   * `SELECT ... FOR UPDATE` on the user's balance row — §9.5.
   *
   * **Always the first statement of any mutation** (§10.2, rule 3). A
   * consistent lock order across every code path is what prevents deadlocks,
   * and one documented rule is cheaper than debugging an intermittent one in
   * production.
   *
   * Raw SQL because Prisma has no `FOR UPDATE`. Parameterised explicitly, as
   * §19.3 requires of the few places raw SQL is used at all.
   */
  private async lockBalance(
    tx: PrismaTransactionClient,
    userId: string,
  ): Promise<UserBalance> {
    const rows = await tx.$queryRaw<UserBalanceRow[]>`
      SELECT id, user_id, pending_points, available_points, locked_points,
             lifetime_earned_points, lifetime_withdrawn_points,
             lifetime_reversed_points, version
        FROM user_balances
       WHERE user_id = ${userId}::uuid
         FOR UPDATE`;

    const row = rows[0];

    if (!row) {
      /*
       * The row is created with the user, so this means either an id that was
       * never a user or a registration that half-committed. Refusing is right:
       * creating one here would let a credit succeed for a user that does not
       * exist, and the missing row is the only evidence that something else
       * went wrong.
       */
      throw new DomainError(
        ERROR_CODES.USER_NOT_FOUND,
        'No balance for this user',
        404,
        { userId },
      );
    }

    return {
      id: row.id,
      userId: row.user_id,
      pendingPoints: row.pending_points,
      availablePoints: row.available_points,
      lockedPoints: row.locked_points,
      lifetimeEarnedPoints: row.lifetime_earned_points,
      lifetimeWithdrawnPoints: row.lifetime_withdrawn_points,
      lifetimeReversedPoints: row.lifetime_reversed_points,
      version: row.version,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  /**
   * The history row and the balance update, together.
   *
   * Runs with the balance row already locked, so the read-modify-write below
   * cannot interleave with another mutation for the same user.
   */
  private async write(
    tx: PrismaTransactionClient,
    movement: Movement & { sourceTransactionId: string | null },
    balance: UserBalance,
  ): Promise<RewardTransactionRecord> {
    const created = await tx.rewardTransaction.create({
      data: {
        id: uuidv7(),
        userId: movement.userId,
        type: movement.type,
        amountPoints: movement.amountPoints,
        pendingDelta: movement.pendingDelta,
        availableDelta: movement.availableDelta,
        lockedDelta: movement.lockedDelta,
        sourceType: movement.source.type,
        sourceId: movement.source.id ?? null,
        sourceTransactionId: movement.sourceTransactionId,
        actorType: movement.actor.type,
        actorId: movement.actor.id ?? null,
        reason: movement.reason,
        maturesAt: movement.maturesAt,
        holdPeriodDays: movement.holdPeriodDays,
        createdAt: movement.at,
      },
    });

    await tx.userBalance.update({
      where: { id: balance.id },
      data: {
        pendingPoints: { increment: movement.pendingDelta },
        availablePoints: { increment: movement.availableDelta },
        lockedPoints: { increment: movement.lockedDelta },
        lifetimeEarnedPoints: { increment: movement.lifetime.earned ?? 0 },
        lifetimeWithdrawnPoints: { increment: movement.lifetime.withdrawn ?? 0 },
        lifetimeReversedPoints: { increment: movement.lifetime.reversed ?? 0 },
        version: { increment: 1 },
      },
    });

    return toRecord(created);
  }
}

interface Movement {
  userId: string;
  type: RewardTransactionType;
  amountPoints: number;
  pendingDelta: number;
  availableDelta: number;
  lockedDelta: number;
  source: RewardSource;
  sourceTransactionId?: string | null;
  actor: RewardActor;
  reason: string | null;
  maturesAt: Date | null;
  holdPeriodDays: number | null;
  lifetime: { earned?: number; withdrawn?: number; reversed?: number };
  at: Date;
}

/** The shape `SELECT ... FOR UPDATE` returns — snake_case, straight from Postgres. */
interface UserBalanceRow {
  id: string;
  user_id: string;
  pending_points: number;
  available_points: number;
  locked_points: number;
  lifetime_earned_points: number;
  lifetime_withdrawn_points: number;
  lifetime_reversed_points: number;
  version: number;
}

export function toBalance(row: UserBalance | null): Balance {
  const pending = row?.pendingPoints ?? 0;
  const available = row?.availablePoints ?? 0;
  const locked = row?.lockedPoints ?? 0;

  return {
    pending,
    available,
    locked,
    total: pending + available + locked,
    lifetimeEarned: row?.lifetimeEarnedPoints ?? 0,
    lifetimeWithdrawn: row?.lifetimeWithdrawnPoints ?? 0,
    lifetimeReversed: row?.lifetimeReversedPoints ?? 0,
  };
}

export function toRecord(row: RewardTransaction): RewardTransactionRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    amountPoints: row.amountPoints,
    pendingDelta: row.pendingDelta,
    availableDelta: row.availableDelta,
    lockedDelta: row.lockedDelta,
    sourceType: row.sourceType as RewardSourceType,
    sourceId: row.sourceId,
    sourceTransactionId: row.sourceTransactionId,
    actorType: row.actorType,
    actorId: row.actorId,
    reason: row.reason,
    maturesAt: row.maturesAt?.toISOString() ?? null,
    holdPeriodDays: row.holdPeriodDays,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Amounts are positive integers, always.
 *
 * The *direction* is the operation's job, not the caller's: a `credit(-100)`
 * that quietly debited would be a bug nobody could see at the call site, and a
 * fractional point is not a thing that exists (DATABASE.md §5).
 */
function requirePositive(amountPoints: number): number {
  if (!Number.isInteger(amountPoints) || amountPoints <= 0) {
    throw new ValidationError('Invalid points amount', [
      { field: 'amountPoints', message: 'must be a positive integer' },
    ]);
  }

  return amountPoints;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

export const __testing = { requirePositive, clampLimit, toBalance, DEFAULT_LIMIT, MAX_LIMIT };
