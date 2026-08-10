/**
 * Conversion contracts — the interpreted, attributed result of a postback.
 *
 * DATABASE.md §3.4 draws the line this file sits on: `provider_postbacks` is
 * **what arrived**, `conversions` is **what it meant**. A conversion is the
 * business event that a user completed an offer.
 *
 * It is never responsible for the balance effect. Crediting is a
 * `reward_transactions` row created by `RewardAccountingService`; a conversion
 * records *that a thing happened*, not *what the balance became* (P2).
 */

/**
 * The lifecycle of one conversion.
 *
 * Two distinct things are folded into one column on purpose: what the provider
 * says about the event, and what we have done about it. They are folded
 * because only one of them is ever the *current* answer — a conversion the
 * provider has not finalised cannot also be credited — and because a second
 * status column is a second thing that can disagree with the first.
 *
 * What the provider actually reported is kept verbatim alongside, so a derived
 * status always has its input next to it.
 */
export const CONVERSION_STATUSES = {
  /**
   * The provider has not finalised this event. Nothing may be credited for it.
   *
   * Not an error and not a hold: some networks report an install the moment it
   * happens and confirm it days later, once their own anti-fraud has cleared.
   */
  PENDING: 'PENDING',

  /**
   * Matched to a click, priced, and recorded — with no balance effect applied.
   *
   * This is the state a conversion sits in between being recognised and being
   * credited. Today that is every confirmed conversion, because crediting is
   * not built; afterwards it remains the state of anything whose credit has
   * not completed.
   */
  ATTRIBUTED: 'ATTRIBUTED',

  /** Points have been credited. Written by the reward flow (§9.3). */
  CREDITED: 'CREDITED',

  /**
   * Recognised but withheld pending a human decision.
   *
   * Points are held rather than refused, deliberately (§10.3): a false
   * positive that refuses a legitimate conversion produces an angry user and
   * no recoverable record, while one that holds it produces a delay an admin
   * can clear. Both are wrong; only one is recoverable.
   */
  HELD: 'HELD',

  /** A later chargeback took this back. The row stays — reversals are rows, not edits. */
  REVERSED: 'REVERSED',

  /** The provider itself rejected the event. It never earned anything. */
  REJECTED: 'REJECTED',
} as const;

export type ConversionStatus =
  (typeof CONVERSION_STATUSES)[keyof typeof CONVERSION_STATUSES];

export const CONVERSION_TYPES = {
  CONVERSION: 'CONVERSION',
  /**
   * A chargeback of an earlier conversion, pointing at it.
   *
   * A row rather than an edit (DATABASE.md §3.4). Editing the original away
   * would destroy the record that the user *did* complete the offer — which is
   * exactly what matters when disputing the reversal with the provider.
   */
  REVERSAL: 'REVERSAL',
} as const;

export type ConversionType = (typeof CONVERSION_TYPES)[keyof typeof CONVERSION_TYPES];

/**
 * Why a postback produced no conversion.
 *
 * Every one of these leaves the postback `QUARANTINED` rather than dropped.
 * PROJECT.md §4.4 is explicit: unmatched postbacks are quarantined for admin
 * review, **never silently dropped** — a silent drop is a user who completed
 * an offer, was never paid, and about whom no record exists to argue with.
 */
export const QUARANTINE_REASONS = {
  /** The `sub_id` failed its signature check, so it was never one of ours. */
  SUB_ID_INVALID: 'SUB_ID_INVALID',
  /** Signed by us, but no click carries it. */
  CLICK_NOT_FOUND: 'CLICK_NOT_FOUND',
  /** The click exists and its attribution window had already closed. */
  ATTRIBUTION_EXPIRED: 'ATTRIBUTION_EXPIRED',
  /** One provider reported a conversion against another provider's click. */
  PROVIDER_MISMATCH: 'PROVIDER_MISMATCH',
  /** The payout arrived in a currency the configured rate is not calibrated for. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  /** A reversal naming no conversion we have seen. Quarantined, not ignored (§10.3). */
  REVERSAL_ORIGINAL_NOT_FOUND: 'REVERSAL_ORIGINAL_NOT_FOUND',
  /** A reversal that could equally apply to more than one conversion on the click. */
  REVERSAL_AMBIGUOUS: 'REVERSAL_AMBIGUOUS',
  /** The archived payload no longer parses. Fix the adapter, then replay. */
  PAYLOAD_UNREADABLE: 'PAYLOAD_UNREADABLE',
  /** No adapter is usable for the provider, so the payload cannot be read at all. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
} as const;

export type QuarantineReason =
  (typeof QUARANTINE_REASONS)[keyof typeof QUARANTINE_REASONS];

/** What one processing run did. Returned by the worker and by the service. */
export interface ConversionProcessingResult {
  postbackId: string;
  outcome: 'converted' | 'quarantined' | 'skipped';
  conversionId: string | null;
  /** Present when the outcome is `quarantined`. */
  reason: QuarantineReason | null;
}

/**
 * One conversion, as an admin investigation sees it.
 *
 * There is no user-facing shape yet. What a user wants to know about a
 * conversion is what it paid them, and that answer does not exist until the
 * reward flow does.
 */
export interface AdminConversionSummary {
  id: string;
  type: ConversionType;
  status: ConversionStatus;

  clickId: string;
  userId: string;
  providerId: string;
  providerSlug: string;
  offerId: string;

  /** The archived postback this was derived from. One conversion per postback. */
  postbackId: string;

  // --- What the provider reported, kept verbatim -------------------------

  externalTransactionId: string;
  /** The provider's own campaign reference, when it sent one. Not enforced against the click. */
  externalOfferId: string | null;
  payoutAmountMinor: number;
  payoutCurrency: string;
  /** `confirmed` / `pending` / `rejected`, as normalized by the adapter. */
  providerStatus: string;
  /** When the provider says it happened. Null when the payload omitted it. */
  occurredAt: string | null;

  // --- What we computed, and the rule in force when we computed it -------

  rewardPoints: number;
  /**
   * The rate used, stored on the row.
   *
   * Rates change (P3). Without them, a conversion's point value cannot be
   * explained later, and "why did I get fewer points than my friend for the
   * same offer?" becomes unanswerable — the same reasoning as the click
   * snapshot and the stored hold period.
   */
  pointsPerMinorUnit: number;
  rewardSharePercent: number;

  /*
   * What the user was *promised* is deliberately not duplicated here. It is
   * `reward_points_snapshot` on the click, which is immutable — so a join
   * always gives the same answer a copy would, and `clickId` below is how an
   * investigation reaches it. Promised-versus-paid is answered by the two rows
   * together, not by storing one on the other (P6).
   */

  /** The conversion this one reverses, for a `REVERSAL` row. */
  reversalOfId: string | null;
  /** Why it is held or rejected, when it is. */
  reviewReason: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface AdminListConversionsQuery {
  userId?: string;
  clickId?: string;
  providerId?: string;
  offerId?: string;
  status?: ConversionStatus;
  type?: ConversionType;
  externalTransactionId?: string;
  limit?: number;
  offset?: number;
  /**
   * Newest first by default.
   *
   * `asc` exists for the review queue: a held conversion is a user who earned
   * points and cannot spend them, and newest-first lets the tail of that queue
   * age indefinitely.
   */
  order?: 'asc' | 'desc';
}
