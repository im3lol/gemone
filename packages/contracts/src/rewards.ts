/**
 * Reward accounting contracts — P2.
 *
 * PROJECT.md's second principle: reward accounting is defined by an
 * **interface**, not by a storage strategy. Everything in this file describes
 * what a caller sees; nothing in it says whether a balance is a mutable row or
 * a fold over an append-only ledger. That silence is the point — it is what
 * lets the storage model be decided on production evidence rather than on a
 * guess made in week one.
 *
 * The MVP ships the simple balance model. The cost of that choice is R4: a
 * mutable row is exactly what concurrent credits, locks and reversals contend
 * over. The mitigations live in the implementation; the migration path lives
 * here, in the shape of these types.
 */

/**
 * A balance is **three buckets, never one number** (ARCHITECTURE.md §9.2).
 *
 * Every operation in the system cares about a specific bucket — a withdrawal
 * locks only `available`, a chargeback prefers `pending`, a user sees all
 * three. Collapsing them into one scalar means every caller re-derives the
 * split, and one caller getting it wrong pays out held money.
 */
export interface Balance {
  /** Credited, inside the hold period. Becomes `available` when it elapses. */
  pending: number;
  /** Withdrawable now. */
  available: number;
  /** Reserved by an in-flight payout. Consumed on settle, returned on rejection. */
  locked: number;

  /**
   * `pending + available + locked`. Provided so nobody adds it up wrongly, and
   * explicitly **not** the number to check before a withdrawal — only
   * `available` is lockable.
   */
  total: number;

  lifetimeEarned: number;
  lifetimeWithdrawn: number;
  lifetimeReversed: number;
}

/**
 * The closed set of things that can move points — PROJECT.md §4.5.
 *
 * Owned by the domain, not by any storage schema. A new type is a deliberate
 * addition here, which is what stops "some other kind of adjustment" being
 * invented at a call site.
 */
export const REWARD_TRANSACTION_TYPES = {
  /** A conversion was recognised. Lands in `pending`. */
  CONVERSION_CREDIT: 'CONVERSION_CREDIT',
  /** A chargeback took a credit back. Prefers `pending`, then `available`. */
  CHARGEBACK_DEBIT: 'CHARGEBACK_DEBIT',
  /**
   * A hold period elapsed: `pending` → `available`.
   *
   * Not among the seven types PROJECT.md §4.5 lists, and added deliberately —
   * see DECISIONS.md D38. Without it, the pending-to-available move is the one
   * balance change with no transaction behind it, and reconciliation stops
   * being a sum.
   */
  REWARD_MATURATION: 'REWARD_MATURATION',
  /** A withdrawal request reserved points: `available` → `locked`. */
  PAYOUT_LOCK: 'PAYOUT_LOCK',
  /** A withdrawal was paid: `locked` is consumed. */
  PAYOUT_SETTLE: 'PAYOUT_SETTLE',
  /** A withdrawal was rejected or failed: `locked` → `available`. */
  PAYOUT_REFUND: 'PAYOUT_REFUND',
  /** An admin moved points by hand. Always carries a reason and an actor. */
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
  /** A promotional grant. */
  BONUS: 'BONUS',
} as const;

export type RewardTransactionType =
  (typeof REWARD_TRANSACTION_TYPES)[keyof typeof REWARD_TRANSACTION_TYPES];

/**
 * Who caused a mutation.
 *
 * A discriminated actor rather than a nullable user id (DATABASE.md §8): most
 * balance movements are made by the system, and a null id cannot distinguish
 * "the system did it" from "we forgot to record who did it".
 */
export const REWARD_ACTOR_TYPES = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  ADMIN: 'ADMIN',
} as const;

export type RewardActorType =
  (typeof REWARD_ACTOR_TYPES)[keyof typeof REWARD_ACTOR_TYPES];

/** What a movement was about. Polymorphic, so it carries no foreign key. */
export const REWARD_SOURCE_TYPES = {
  CONVERSION: 'CONVERSION',
  PAYOUT: 'PAYOUT',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;

export type RewardSourceType =
  (typeof REWARD_SOURCE_TYPES)[keyof typeof REWARD_SOURCE_TYPES];

/**
 * Every mutation returns one of these — PROJECT.md §4.5.
 *
 * **Callers depend on this record, not on how it is stored.** That sentence is
 * the whole migration path: a ledger implementation would return the same
 * shape from a completely different write.
 */
export interface RewardTransactionRecord {
  id: string;
  userId: string;
  type: RewardTransactionType;

  /**
   * Signed, in points, from the user's point of view: `+171` for a credit,
   * `-171` for a chargeback, `0` for a maturation — which moves points between
   * buckets without anyone earning or losing anything.
   */
  amountPoints: number;

  /**
   * The per-bucket effect.
   *
   * Their sums over a user's history **are** that user's balance. That is not
   * an incidental property: it is the reconciliation invariant (PROJECT.md
   * R4), and it is what a ledger implementation would replay to become
   * authoritative.
   */
  pendingDelta: number;
  availableDelta: number;
  lockedDelta: number;

  sourceType: RewardSourceType;
  sourceId: string | null;
  /** The transaction this one acts upon — a maturation, a chargeback, a settle. */
  sourceTransactionId: string | null;

  actorType: RewardActorType;
  actorId: string | null;
  reason: string | null;

  /**
   * When these points become withdrawable, resolved at credit time and stored.
   *
   * **Stored, never re-resolved** (ARCHITECTURE.md §9.4). That is what makes
   * "hold period changes apply to newly credited conversions only"
   * structurally true rather than a rule someone has to remember: an admin
   * shortening the period cannot retroactively re-hold points a user has
   * already been told are available, and lengthening it cannot claw back
   * points already released.
   *
   * Null on a credit means **held indefinitely** — it matures when a human
   * says so, not when a clock does.
   */
  maturesAt: string | null;
  /** The resolved period, so the maturity date can be explained later. */
  holdPeriodDays: number | null;

  createdAt: string;
}

/** A page of statement entries as the owning user sees them. */
export interface RewardHistoryQuery {
  type?: RewardTransactionType;
  limit?: number;
  offset?: number;
}

export interface AdminRewardHistoryQuery extends RewardHistoryQuery {
  userId?: string;
  sourceId?: string;
}

/**
 * The result of checking a balance against its own history.
 *
 * PROJECT.md R5 is explicit about what this is for: **"If reconciliation
 * reports any unexplained drift in production, that is the signal to migrate —
 * not a bug to patch."** So it reports rather than repairs.
 */
export interface BalanceReconciliation {
  userId: string;
  balanced: boolean;
  /** What the balance row says. */
  recorded: Pick<Balance, 'pending' | 'available' | 'locked'>;
  /** What the transaction history sums to. */
  expected: Pick<Balance, 'pending' | 'available' | 'locked'>;
  /** `recorded - expected`, per bucket. All zero when balanced. */
  drift: Pick<Balance, 'pending' | 'available' | 'locked'>;
  transactionCount: number;
}
