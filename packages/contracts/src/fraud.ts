/**
 * Fraud scoring — PROJECT.md §4.7, ARCHITECTURE.md §4.2, DATABASE.md §3.6.
 *
 * The engine evaluates and records evidence. It never moves money: the action
 * it returns is a *recommendation* the caller applies through
 * `RewardAccountingService`, which remains the only thing that touches a
 * balance (P2).
 */

/**
 * What the engine recommends doing about a conversion.
 *
 * Ordered by severity, and that order is load-bearing: when several rules fire,
 * the most severe action wins (`ALLOW` < `HOLD` < `REVIEW` < `BLOCK`).
 */
export const FRAUD_ACTIONS = {
  /** Nothing fired, or what fired is worth recording and not acting on. */
  ALLOW: 'ALLOW',

  /**
   * Credit the points and withhold them pending review.
   *
   * The default response to risk, deliberately (PROJECT.md §4.7): "Rejecting
   * legitimate users is more expensive than a short hold." A false positive
   * here costs a delay an admin can clear; a false positive that refuses costs
   * a record that no longer exists.
   */
  HOLD: 'HOLD',

  /**
   * Hold, and mark the account itself as needing a look.
   *
   * Distinct from `HOLD` because the subject differs: `HOLD` doubts one
   * conversion, `REVIEW` doubts the account that produced it.
   */
  REVIEW: 'REVIEW',

  /**
   * Record the conversion and credit nothing.
   *
   * Reserved for evidence that the event was never legitimate rather than
   * merely suspicious. Nothing in the MVP rule set defaults to it — it exists
   * so an admin can configure a rule up to it (P3), not so code can choose it.
   */
  BLOCK: 'BLOCK',
} as const;

export type FraudAction = (typeof FRAUD_ACTIONS)[keyof typeof FRAUD_ACTIONS];

/**
 * Severity order, used to combine the actions of several triggered rules.
 *
 * Exported because the ordering is a business rule, not an implementation
 * detail: an admin configuring a rule's action needs the same ranking the
 * engine uses.
 */
export const FRAUD_ACTION_SEVERITY: Readonly<Record<FraudAction, number>> = {
  [FRAUD_ACTIONS.ALLOW]: 0,
  [FRAUD_ACTIONS.HOLD]: 1,
  [FRAUD_ACTIONS.REVIEW]: 2,
  [FRAUD_ACTIONS.BLOCK]: 3,
};

/**
 * The rules that can fire, as stable identifiers.
 *
 * Stable because they are stored on `fraud_evaluations` and read back months
 * later to explain a hold. Renaming one silently rewrites history, so these are
 * treated like error codes: additive only.
 */
export const FRAUD_RULES = {
  /** Conversions by this user within the configured window. */
  USER_CONVERSION_VELOCITY: 'USER_CONVERSION_VELOCITY',
  /** Conversions from this click's IP within the configured window. */
  IP_CONVERSION_VELOCITY: 'IP_CONVERSION_VELOCITY',
  /** Distinct accounts sharing this click's IP. */
  SHARED_IP_ACCOUNTS: 'SHARED_IP_ACCOUNTS',
  /** Distinct accounts sharing this click's device fingerprint. */
  SHARED_DEVICE_ACCOUNTS: 'SHARED_DEVICE_ACCOUNTS',
  /** Click to conversion faster than the offer could plausibly be completed. */
  IMPOSSIBLE_TIMING: 'IMPOSSIBLE_TIMING',
  /** Share of this user's conversions that ended up reversed. */
  CHARGEBACK_RATE: 'CHARGEBACK_RATE',
  /** Registration email is on the disposable-domain blocklist. */
  DISPOSABLE_EMAIL: 'DISPOSABLE_EMAIL',
} as const;

export type FraudRuleId = (typeof FRAUD_RULES)[keyof typeof FRAUD_RULES];

/**
 * One rule that fired, with the numbers behind it.
 *
 * `observed` and `threshold` are both recorded because "which rule held this,
 * at what threshold?" is the question an admin asks first (DATABASE.md §3.6),
 * and neither number answers it alone.
 */
export interface TriggeredRule {
  rule: FraudRuleId;
  /** What the rule measured. */
  observed: number;
  /** What it was measured against, as configured at evaluation time. */
  threshold: number;
  /** Points added to the score by this rule. */
  weight: number;
  /** The action this rule alone recommends. */
  action: FraudAction;
  /** One line, safe to show an admin. */
  detail: string;
}

/**
 * A rule's configuration at the moment of evaluation.
 *
 * Snapshotted onto every evaluation (DATABASE.md §3.6) — thresholds are tuned
 * continuously (P3), and re-reading current configuration to explain a hold
 * from last month answers a different question than the one being asked.
 */
export interface FraudRuleSnapshot {
  rule: FraudRuleId;
  enabled: boolean;
  threshold: number;
  weight: number;
  action: FraudAction;
}

/** What the engine returns. Advisory: the caller decides what to do with it. */
export interface FraudEvaluationResult {
  score: number;
  action: FraudAction;
  triggered: TriggeredRule[];
  /** Every rule's configuration, fired or not. */
  snapshot: FraudRuleSnapshot[];
  /**
   * Rules that could not be evaluated because the input lacked what they need
   * — a click with no IP, a user with no email on record.
   *
   * Recorded rather than silently skipped: "no rule fired" and "the rule never
   * ran" are different facts, and only one of them is reassuring.
   */
  skipped: { rule: FraudRuleId; reason: string }[];
}

/** A stored evaluation, as an admin reads it back. */
export interface AdminFraudEvaluationSummary {
  id: string;
  conversionId: string | null;
  userId: string;
  score: number;
  /** What the engine recommended. */
  recommendedAction: FraudAction;
  /** What the caller actually did, which may differ (DATABASE.md §3.6). */
  appliedAction: FraudAction;
  triggeredRules: FraudRuleId[];
  evaluatedAt: string;
}

export interface AdminFraudEvaluationDetail extends AdminFraudEvaluationSummary {
  triggered: TriggeredRule[];
  snapshot: FraudRuleSnapshot[];
  skipped: { rule: FraudRuleId; reason: string }[];
}

/** How an admin resolves a conversion the engine held. */
export const FRAUD_REVIEW_DECISIONS = {
  /**
   * Not fraud. The held points mature and become withdrawable.
   *
   * Applied through `RewardAccountingService.mature()` — the review screen
   * decides, the accounting service moves (P2).
   */
  CLEAR: 'CLEAR',
  /**
   * Fraud. The credit is reversed and the points leave the balance.
   *
   * Applied through `RewardAccountingService.reverse()`, for the same reason.
   */
  CONFIRM: 'CONFIRM',
} as const;

export type FraudReviewDecision =
  (typeof FRAUD_REVIEW_DECISIONS)[keyof typeof FRAUD_REVIEW_DECISIONS];

export interface ReviewHeldConversionRequest {
  decision: FraudReviewDecision;
  /** Required. A held conversion resolved without a stated reason is a decision nobody can audit. */
  reason: string;
}

export interface AdminHeldConversionSummary {
  conversionId: string;
  userId: string;
  rewardPoints: number;
  reviewReason: string | null;
  fraudScore: number | null;
  triggeredRules: FraudRuleId[];
  occurredAt: string | null;
  createdAt: string;
}

/** What §11.3 wants on the payout review screen, filled in by this module (T32). */
export interface UserFraudSignals {
  /** The highest score any of this user's evaluations reached. */
  peakScore: number;
  /** The most recent evaluation's score, or null if never evaluated. */
  latestScore: number | null;
  /** Evaluations that recommended anything other than ALLOW. */
  flaggedCount: number;
  /** Rules that have ever fired for this user. */
  rulesEverTriggered: FraudRuleId[];
}
