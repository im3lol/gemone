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

  /**
   * What to call the source, in the words the user was shown.
   *
   * The offer title for a conversion credit — and for the maturation and the
   * chargeback that act on it, which copy it — so a statement can say "Offer
   * completed · Quick Survey" instead of "Offer completed" and an opaque id.
   * Null wherever the caller had no name to give: payout movements and manual
   * adjustments carry none today.
   *
   * **Recorded at write time, never resolved at read time.** `sourceId`
   * deliberately carries no foreign key (see its column comment), and the
   * module that owns this table depends on no other domain module — so there
   * is nothing here to join *to*. Even where a join were possible it would be
   * the wrong answer: offers are overwritten by every catalog sync, so it
   * would print today's title on a line describing money that moved months
   * ago. This is the promise as it stood, the same as the click's own title
   * snapshot.
   */
  sourceLabel: string | null;

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

/**
 * Where a movement's points **are now** — TODO T80.
 *
 * A second axis over the same rows, and the one people actually ask about:
 * "what is still pending?" is a question about the statement's status column,
 * not about its type column. `CONVERSION_CREDIT` is one type and two answers,
 * because a credit lands in `pending` or in `available` depending on the hold
 * period that applied to it.
 *
 * **It describes the movement, not the money.** A credit that has since
 * matured still reads `PENDING`, because that is where *it* put the points;
 * the `CLEARED` maturation beside it is the row that moved them. A statement
 * is a list of events, and an event does not change after it happened.
 *
 * **Not a stored column, and deliberately so.** It is a view over the type and
 * the bucket deltas, which are the facts. Adding a column would mean a status
 * that could disagree with the deltas underneath it — and the deltas are what
 * reconciliation sums.
 *
 * It lives in the contract rather than in either application because both need
 * it and they need it to mean the same thing: the API filters on it, the web
 * renders it. See `REWARD_STATUS_RULES` for how one definition does both.
 */
export const REWARD_STATUSES = {
  /** A credit that landed in `pending`, because a hold period applied to it. */
  PENDING: 'PENDING',
  /** A credit that landed straight in `available` — the hold resolved to zero. */
  AVAILABLE: 'AVAILABLE',
  /** A hold elapsed and the points moved from `pending` to `available`. */
  CLEARED: 'CLEARED',
  /** A chargeback took a credit back. */
  REVERSED: 'REVERSED',
  /** Reserved by a withdrawal that is still being decided. */
  IN_REVIEW: 'IN_REVIEW',
  /** A withdrawal was settled. */
  PAID: 'PAID',
  /** A withdrawal was rejected or failed, and the points came back. */
  RETURNED: 'RETURNED',
  /** An administrator moved points by hand. */
  ADJUSTED: 'ADJUSTED',
} as const;

export type RewardStatus = (typeof REWARD_STATUSES)[keyof typeof REWARD_STATUSES];

/**
 * What makes a row that status — written as **data, not as a function body**.
 *
 * This is the shape that lets one definition serve both sides. A predicate can
 * only be run over rows already fetched, which is the client-side filter T80
 * refused: twenty rows fetched, four shown, "1–20 of 28" printed above them.
 * A rule that is data can also be *translated* — the API turns each one into a
 * `where` clause and filters and counts in the database, so the pager's total
 * is the filtered total.
 *
 * The rules are disjoint and cover all eight transaction types, which is what
 * makes `rewardStatusOf` total and the translation lossless. Both properties
 * are asserted by tests on either side rather than assumed here.
 */
export interface RewardStatusRule {
  /** The transaction types that can carry this status. */
  types: readonly RewardTransactionType[];

  /**
   * The constraint on `pendingDelta`, where the type alone is not enough.
   *
   * Only credits need it, and only because "did this land in pending" is the
   * whole difference between `PENDING` and `AVAILABLE`.
   */
  pendingDelta?: 'positive' | 'nonPositive';
}

const CREDIT_TYPES = [
  REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
  REWARD_TRANSACTION_TYPES.BONUS,
] as const;

export const REWARD_STATUS_RULES: Readonly<Record<RewardStatus, RewardStatusRule>> = {
  PENDING: { types: CREDIT_TYPES, pendingDelta: 'positive' },
  AVAILABLE: { types: CREDIT_TYPES, pendingDelta: 'nonPositive' },
  CLEARED: { types: [REWARD_TRANSACTION_TYPES.REWARD_MATURATION] },
  REVERSED: { types: [REWARD_TRANSACTION_TYPES.CHARGEBACK_DEBIT] },
  IN_REVIEW: { types: [REWARD_TRANSACTION_TYPES.PAYOUT_LOCK] },
  PAID: { types: [REWARD_TRANSACTION_TYPES.PAYOUT_SETTLE] },
  RETURNED: { types: [REWARD_TRANSACTION_TYPES.PAYOUT_REFUND] },
  ADJUSTED: { types: [REWARD_TRANSACTION_TYPES.MANUAL_ADJUSTMENT] },
};

export const REWARD_STATUSES_IN_ORDER: RewardStatus[] = Object.keys(
  REWARD_STATUS_RULES,
) as RewardStatus[];

/**
 * The status of one movement, by the same rules the API filters with.
 *
 * Takes the two fields the rules read rather than a whole record, so a caller
 * holding a database row can ask without building a wire object first.
 *
 * Returns `null` for a type this build has never heard of — a newer server, a
 * replayed record. A closed union with a silent fallback would put a wrong
 * word beside somebody's money; `null` makes the caller say what it does about
 * not knowing.
 *
 * **Nothing here consults a clock.** A pending credit whose `maturesAt` has
 * passed is still pending until a `REWARD_MATURATION` row exists, because that
 * row is what actually moved the points. A status that ran ahead of the
 * balance would be the more confusing of the two disagreements.
 */
export function rewardStatusOf(movement: {
  type: RewardTransactionType;
  pendingDelta: number;
}): RewardStatus | null {
  for (const status of REWARD_STATUSES_IN_ORDER) {
    const rule = REWARD_STATUS_RULES[status];

    if (!rule.types.includes(movement.type)) continue;
    if (rule.pendingDelta === 'positive' && !(movement.pendingDelta > 0)) continue;
    if (rule.pendingDelta === 'nonPositive' && movement.pendingDelta > 0) continue;

    return status;
  }

  return null;
}

/** A page of statement entries as the owning user sees them. */
export interface RewardHistoryQuery {
  type?: RewardTransactionType;

  /**
   * Filters on the derived status — see `REWARD_STATUSES`.
   *
   * Independent of `type`, and combinable with it: the two are different
   * questions about the same row. Asking for both narrows to their
   * intersection, which is empty for an impossible pair such as
   * `type=PAYOUT_SETTLE&status=PENDING` — the honest answer, and one the
   * database gives without special-casing.
   */
  status?: RewardStatus;

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
