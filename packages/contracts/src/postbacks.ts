/**
 * Postback contracts — the intake half of the `conversions` module.
 *
 * ARCHITECTURE.md §10 and DATABASE.md §3.4. A postback is what a provider
 * *sent*, never what it *meant*: this file describes the archive and the
 * acknowledgement, and deliberately describes no business outcome. The
 * interpreted result is a conversion, and conversions are a different table
 * with a different vocabulary.
 */

/**
 * Processing state of one archived postback.
 *
 * `RECEIVED` and `REJECTED` are written by the intake surface; the rest are
 * the processing worker's vocabulary and are declared here because adding an
 * enum value later is a migration on the highest-volume table in the system.
 *
 * There is no `DUPLICATE`. DATABASE.md §3.4 lists one, but the unique
 * constraint means a duplicate never becomes a row — there is nothing to put
 * a state on. §10.1's "mark duplicate" is `duplicateCount` on the row it
 * duplicates.
 */
export const POSTBACK_STATES = {
  /** Archived, awaiting processing. */
  RECEIVED: 'RECEIVED',
  /** Processed into a conversion. Terminal. */
  PROCESSED: 'PROCESSED',
  /** No click matched, or the attribution window had closed. Needs a human. */
  QUARANTINED: 'QUARANTINED',
  /** Authentic but unusable — it verified and would not parse. */
  REJECTED: 'REJECTED',
  /** Processing failed repeatedly. Retryable once the cause is fixed. */
  FAILED: 'FAILED',
} as const;

export type PostbackState = (typeof POSTBACK_STATES)[keyof typeof POSTBACK_STATES];

/**
 * What a provider's server gets back on a 200.
 *
 * Deliberately carries **no identifier**. Our ids are UUIDv7, which embeds a
 * timestamp and sorts monotonically, so handing one to a third party
 * publishes our conversion volume — the same reasoning that made `sub_id`
 * random rather than the click's primary key (§19.2).
 */
export interface PostbackAcknowledgement {
  /** `accepted` on first receipt, `duplicate` on every retry of the same event. */
  status: 'accepted' | 'duplicate';
}

/**
 * One archived postback, as an admin list shows it.
 *
 * Without the payload: a list page rendering hundreds of raw provider bodies
 * is a slow page nobody reads. The payload is on the detail view, which is
 * where somebody is actually investigating one event.
 */
export interface AdminPostbackSummary {
  id: string;
  providerId: string;
  providerSlug: string;

  /**
   * The provider's own transaction id — half of the idempotency key.
   *
   * Null only for a `REJECTED` row: an unparseable payload has no id to
   * extract, which is also why such rows cannot be deduplicated.
   */
  externalTransactionId: string | null;

  state: PostbackState;
  sourceIp: string | null;

  /** How many times the provider re-sent this same event after the first. */
  duplicateCount: number;
  lastDuplicateAt: string | null;

  processingAttempts: number;
  /** One line, safe to show an admin. Never a stack trace (§15.3). */
  errorDetail: string | null;

  receivedAt: string;
}

/** The detail view: everything above, plus the verbatim evidence. */
export interface AdminPostbackDetail extends AdminPostbackSummary {
  /**
   * Exactly what arrived — method, query and body — unmodified.
   *
   * This is the dispute evidence and the replay source (§10.1). It is shown
   * only to an admin because it is a provider's raw payload, which §15.3
   * keeps out of every client-facing response.
   */
  payload: unknown;

  /** A captured subset of the request headers. Never credential-bearing ones. */
  headers: Record<string, string>;
}

export interface AdminListPostbacksQuery {
  providerId?: string;
  state?: PostbackState;
  externalTransactionId?: string;
  sourceIp?: string;
  limit?: number;
  offset?: number;
}
