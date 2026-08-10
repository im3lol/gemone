/**
 * Click contracts — the attribution record.
 *
 * PROJECT.md §4.3 and DATABASE.md §3.3. A click is **the promise made to the
 * user**, and the only thing that can later connect an incoming postback to an
 * account. Everything here exists so that a dispute weeks later has an answer.
 */

/**
 * What the client gets back after a click is recorded.
 *
 * The row is written **before** the redirect (PROJECT.md §4.3). If the write
 * fails there is no redirect, because a user sent to a provider with no click
 * row behind them is a user who cannot be credited and cannot be helped.
 */
export interface ClickResponse {
  id: string;

  /**
   * The signed, opaque identifier handed to the provider.
   *
   * Never contains a raw user id, so it cannot be enumerated or forged into a
   * credit for an arbitrary account (§19.2). Returned to the client because
   * support tickets are raised against it.
   */
  subId: string;

  /** Absolute, built by the provider's adapter. Never assembled from user input (§19.3). */
  redirectUrl: string;

  offerId: string;
  providerSlug: string;

  /** What the user was shown, frozen at click time. */
  offerTitle: string;
  rewardPoints: number;

  /** After this, a conversion for this click is no longer attributable. */
  attributionExpiresAt: string;
  createdAt: string;
}

/** A click as the owning user sees it. */
export interface ClickSummary {
  id: string;
  subId: string;
  offerId: string;
  providerSlug: string;
  offerTitle: string;
  rewardPoints: number;
  attributionExpiresAt: string;
  /** Derived, not stored — see the note on the column. */
  isExpired: boolean;
  createdAt: string;
}

/**
 * The admin view: the same record plus the evidence captured at click time.
 *
 * Separate from `ClickSummary` rather than a flag on it. An IP address and a
 * device fingerprint are personal data and fraud evidence; they belong on the
 * screen that investigates and nowhere else (§19.3).
 */
export interface AdminClickSummary extends ClickSummary {
  userId: string;
  providerId: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
  referrer: string | null;
}

export interface CreateClickRequest {
  offerId: string;

  /**
   * A client-computed device signal, optional.
   *
   * **Evidence, never trust.** It arrives from the browser, so it can be
   * forged or omitted; it is stored for fraud correlation and no decision is
   * made on it here.
   */
  deviceFingerprint?: string;
}

export interface ListClicksQuery {
  offerId?: string;
  providerId?: string;
  limit?: number;
  offset?: number;
}

export interface AdminListClicksQuery extends ListClicksQuery {
  userId?: string;
  subId?: string;
  ipAddress?: string;
}
