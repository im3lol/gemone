/**
 * Payout contracts — the withdrawal state machine.
 *
 * ARCHITECTURE.md §11 and PROJECT.md §4.6. The MVP is **manual review plus
 * manual payment**: no gateway, no KYC integration, no chargeback exposure of
 * our own. An admin reads the destination, sends the money by whatever means,
 * and records what they did.
 *
 * That is not a shortcut deferred until later — it is the model, and payout
 * *execution* sits behind its own interface (§11.4) so an automated provider
 * slots in without touching either reward accounting or this state machine.
 */
import type { UserFraudSignals } from './fraud.js';

/**
 * The withdrawal lifecycle — §11.1.
 *
 * ```
 *    [user submits]
 *          │
 *          ▼
 *    PENDING_REVIEW ──────► REJECTED      (release lock)
 *          │
 *          │ admin approves
 *          ▼
 *       APPROVED ──────────► FAILED       (release lock)
 *          │
 *          │ admin records the external reference
 *          ▼
 *         PAID              (settle lock)
 * ```
 *
 * Approval and settlement are **two steps, not one**, because the external
 * payment happens between them. Collapsing them would mean marking money paid
 * before it was, and a crash in between would leave the system claiming a
 * payment nobody sent.
 */
export const PAYOUT_STATUSES = {
  /** Submitted. Points are already locked; an admin has not looked yet. */
  PENDING_REVIEW: 'PENDING_REVIEW',
  /** An admin approved it. The money has **not** been sent yet. */
  APPROVED: 'APPROVED',
  /** Sent, with an external reference recorded. The lock is consumed. Terminal. */
  PAID: 'PAID',
  /** Refused, with a mandatory reason. The lock is released. Terminal. */
  REJECTED: 'REJECTED',
  /**
   * The external payment did not go through. The lock is released and the
   * points return to the user.
   *
   * Terminal here — see DECISIONS.md D41. Its lock is gone, so anything that
   * follows is a new request with a new lock rather than a continuation of
   * this one.
   */
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[keyof typeof PAYOUT_STATUSES];

/**
 * What a user asks for.
 *
 * The method is validated against the configured list (P3) rather than against
 * an enum in code: PROJECT.md §4.6 requires that adding a payment method an
 * admin can settle by hand needs no deployment.
 */
export interface CreatePayoutRequest {
  amountPoints: number;
  /** One of the configured methods, e.g. `paypal`. */
  method: string;
  /**
   * Where to send the money — a PayPal address, an IBAN, a wallet address.
   *
   * Free text, deliberately (DECISIONS.md D43). Under a manual payout model the
   * validator is the human who reads it before sending, and per-method format
   * rules in code would contradict "adding a method requires no deployment".
   */
  destination: string;
}

/**
 * A payout as the requesting user sees it.
 *
 * The destination is **masked**. The user supplied it and is entitled to
 * confirm which account they picked, but a full payment destination sitting in
 * an ordinary list response is a payment destination in every browser cache
 * and every screenshot (DATABASE.md §3.5).
 */
export interface PayoutSummary {
  id: string;
  status: PayoutStatus;

  amountPoints: number;
  /** The cash the points were worth, in minor units, at the rate below. */
  cashAmountMinor: number;
  cashCurrency: string;

  method: string;
  /** Enough to recognise the account, not enough to be one. */
  destinationMasked: string;

  /** Set on rejection or failure. The user is entitled to know why. */
  reviewReason: string | null;

  createdAt: string;
  reviewedAt: string | null;
  settledAt: string | null;
}

/**
 * A payout as the admin queue lists them.
 *
 * Carries no destination at all. §3.5: "never returned in list responses, only
 * on the detail view an admin explicitly opens, and that view is audited."
 */
export interface AdminPayoutSummary {
  id: string;
  userId: string;
  status: PayoutStatus;

  amountPoints: number;
  cashAmountMinor: number;
  cashCurrency: string;
  /**
   * Points per unit of currency, as resolved when the request was submitted.
   *
   * Stored on the row rather than re-read, for the same reason the reward rate
   * is stored on a conversion: without it, a payout's cash value cannot be
   * explained after the rate changes. This resolves DATABASE.md §13's first
   * open question (DECISIONS.md D42).
   */
  pointsPerCurrencyUnit: number;

  method: string;

  reviewedByAdminId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  /** The bank reference, transaction hash, or whatever the admin recorded. */
  externalReference: string | null;
  settledAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/** The detail view: everything above, plus the destination and review context. */
export interface AdminPayoutDetail extends AdminPayoutSummary {
  /**
   * The full payment destination.
   *
   * Returned **only** here, and fetching it writes an audit entry — reading
   * where someone's money goes is an action, not a lookup (DATABASE.md §3.5).
   */
  destination: string;

  /**
   * What §11.3 says an admin reviews alongside the request.
   *
   * Composed from other modules' services, never from their tables: `admin` is
   * a composition layer (ARCHITECTURE.md §4.3).
   */
  reviewContext: PayoutReviewContext;
}

/**
 * The account, summarised for someone deciding whether to send money.
 *
 * ARCHITECTURE.md §11.3: *"The admin sees the account's fraud score, conversion
 * history, chargeback rate, account age, and any shared-device or shared-IP
 * signals alongside the request."* All of it is here now that `fraud` exists —
 * the score arrived with the module that computes it, rather than as a number
 * nothing stood behind.
 */
export interface PayoutReviewContext {
  accountCreatedAt: string;
  accountStatus: string;
  /** All three buckets — a locked total that does not cover this request is a red flag. */
  balance: { pending: number; available: number; locked: number };
  conversionCount: number;
  /** Conversions this provider or another later took back. The rate that matters. */
  chargebackCount: number;
  /** Payouts already paid to this account. */
  paidPayoutCount: number;
  /**
   * What scoring has seen of this account (§11.3).
   *
   * Null when the account has never been scored — a new account, or one whose
   * conversions all predate the engine. Null rather than zero: zero reads as
   * "scored, and clean", which is the opposite of "never looked at".
   */
  fraud: UserFraudSignals | null;
}

export interface ListPayoutsQuery {
  status?: PayoutStatus;
  limit?: number;
  offset?: number;
}

export interface AdminListPayoutsQuery extends ListPayoutsQuery {
  userId?: string;
  method?: string;
}

/** Approve, reject, or fail. Every one of them needs a reason except approval. */
export interface ReviewPayoutRequest {
  reason: string;
}

export interface SettlePayoutRequest {
  /**
   * The reference from wherever the money actually moved.
   *
   * Mandatory: "paid" with nothing to point at is a claim, not a record, and
   * it is the only evidence that exists when a user says they never received
   * anything.
   */
  externalReference: string;
}

/**
 * The rules of the withdrawal form, read from configuration.
 *
 * Every field here already existed as a configuration key owned by the
 * `payouts` module (P3) and was readable by nobody but an admin. That made the
 * withdrawal form guess at all of it: the shipped page hard-coded
 * `['paypal']`, which contradicts PROJECT.md §4.6 — *"adding a payment method
 * an admin can settle manually requires no deployment"* — and it could show
 * neither the minimum nor what the points are worth.
 *
 * So this endpoint calculates nothing and decides nothing. It is the read side
 * of settings that were always the source of truth, on a surface the person
 * they constrain is allowed to call.
 */
export interface PayoutOptions {
  /**
   * The methods a withdrawal may be requested through.
   *
   * Ordered as configured, and already narrowed to what the installed payout
   * provider can settle — offering a choice that submission would refuse is
   * the one thing a form's dropdown must not do.
   */
  methods: string[];

  /** The smallest and largest single withdrawal, in points. */
  minimumPoints: number;
  maximumPoints: number;

  /**
   * Points equal to one unit of `currency` — TODO T78.
   *
   * The number that lets a user see what a withdrawal is worth *before*
   * submitting it, rather than discovering the cash value on the request that
   * came back. It is the same rate `submit` stamps onto the request, so the
   * figure the form shows and the figure the payout records agree, unless an
   * admin changes the rate in between.
   */
  pointsPerCurrencyUnit: number;
  /** ISO-4217, from `payouts.currency`. */
  currency: string;
}
