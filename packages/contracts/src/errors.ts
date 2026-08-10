/**
 * Stable error codes — part of the API contract.
 *
 * ARCHITECTURE.md §15.2: clients switch on these codes. HTTP statuses and
 * human-readable messages are NOT part of the contract and may change freely;
 * a code may not. Removing or renaming one is a breaking change.
 *
 * Codes are grouped by domain prefix so that a code always says where it
 * came from without a lookup.
 */
export const ERROR_CODES = {
  // Generic — the smallest set that every surface needs.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // --- Authentication -----------------------------------------------------
  /**
   * Wrong email or wrong password — deliberately one code for both.
   * Distinguishing them tells an attacker which emails are registered.
   */
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  AUTH_WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  /** Access token missing, malformed, or expired. The client should refresh. */
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  /** Refresh token unknown, expired, already used, or revoked. Log in again. */
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  /** Account is suspended, banned, or closed. */
  AUTH_ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',

  // --- Users & administration ---------------------------------------------
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** The requested status transition is not permitted from the current one. */
  USER_INVALID_STATUS_TRANSITION: 'USER_INVALID_STATUS_TRANSITION',
  /** An admin tried to act on their own account in a way that locks them out. */
  ADMIN_SELF_ACTION_FORBIDDEN: 'ADMIN_SELF_ACTION_FORBIDDEN',

  // --- Providers ----------------------------------------------------------
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_SLUG_TAKEN: 'PROVIDER_SLUG_TAKEN',
  /**
   * A provider row names a slug that no adapter in this build implements.
   * Rejected on write, so at runtime it means the code was removed from
   * underneath an existing row (ARCHITECTURE.md §7.3).
   */
  PROVIDER_UNKNOWN_SLUG: 'PROVIDER_UNKNOWN_SLUG',
  /** The provider exists but is switched off. A disabled provider is inert. */
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  /** The stored row is not usable: malformed IP range, out-of-range interval. */
  PROVIDER_INVALID_CONFIGURATION: 'PROVIDER_INVALID_CONFIGURATION',
  /** The caller asked for something this provider's adapter does not do. */
  PROVIDER_CAPABILITY_UNSUPPORTED: 'PROVIDER_CAPABILITY_UNSUPPORTED',

  /*
   * The normalized adapter failure set (§7.2, rule 4). Callers react to these
   * without knowing which provider failed — which is the point.
   */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_RESPONSE_INVALID: 'PROVIDER_RESPONSE_INVALID',

  // --- Offer catalog ------------------------------------------------------
  OFFER_NOT_FOUND: 'OFFER_NOT_FOUND',
  /** The offer is already in the requested state. */
  OFFER_INVALID_STATE_TRANSITION: 'OFFER_INVALID_STATE_TRANSITION',
  /** The catalog sync could not complete. The run row carries the detail. */
  CATALOG_SYNC_FAILED: 'CATALOG_SYNC_FAILED',

  // --- Clicks -------------------------------------------------------------
  CLICK_NOT_FOUND: 'CLICK_NOT_FOUND',
  /** The offer is inactive, or its provider is disabled — no promise can be made. */
  CLICK_OFFER_UNAVAILABLE: 'CLICK_OFFER_UNAVAILABLE',
  /** Too many clicks in the window. A fraud control, not an HTTP throttle (§19.5). */
  CLICK_RATE_LIMIT_EXCEEDED: 'CLICK_RATE_LIMIT_EXCEEDED',
  /** The sub_id failed its signature check, so it was never one of ours. */
  CLICK_SUB_ID_INVALID: 'CLICK_SUB_ID_INVALID',
  /** The click exists but its attribution window has closed. */
  CLICK_ATTRIBUTION_EXPIRED: 'CLICK_ATTRIBUTION_EXPIRED',

  // --- Postbacks ----------------------------------------------------------
  /**
   * The adapter's signature check failed. 401, and deliberately visible: it
   * must show up in the provider's own dashboard, because the usual cause is
   * a secret that was rotated on one side only.
   */
  POSTBACK_SIGNATURE_INVALID: 'POSTBACK_SIGNATURE_INVALID',
  /** The connecting address is outside the provider's configured ranges. 403. */
  POSTBACK_SOURCE_NOT_ALLOWED: 'POSTBACK_SOURCE_NOT_ALLOWED',
  /**
   * Authentic — it verified — but the adapter could not parse it. 400,
   * because retrying identical malformed input is pointless (§10.2). The
   * payload is archived regardless; it is evidence of format drift.
   */
  POSTBACK_PAYLOAD_INVALID: 'POSTBACK_PAYLOAD_INVALID',
  /** Admin lookup of an archived postback that does not exist. */
  POSTBACK_NOT_FOUND: 'POSTBACK_NOT_FOUND',

  // --- Conversions --------------------------------------------------------
  CONVERSION_NOT_FOUND: 'CONVERSION_NOT_FOUND',
  /**
   * Processing could not complete for a reason a retry might fix — the
   * provider's adapter is not loadable, the database refused. Retryable, and
   * the postback stays where a replay can find it.
   */
  CONVERSION_PROCESSING_FAILED: 'CONVERSION_PROCESSING_FAILED',

  // --- Rewards ------------------------------------------------------------
  /**
   * The operation would move more points than the bucket holds.
   *
   * Never raised for a chargeback: a reversal is allowed to drive a balance
   * negative, because a clamped balance is a silently lost debt (§9.5). It is
   * raised when a *withdrawal* asks to lock more than is available.
   */
  REWARD_INSUFFICIENT_BALANCE: 'REWARD_INSUFFICIENT_BALANCE',
  /** The referenced reward transaction does not exist. */
  REWARD_TRANSACTION_NOT_FOUND: 'REWARD_TRANSACTION_NOT_FOUND',
  /** The referenced transaction cannot undergo the requested operation. */
  REWARD_INVALID_OPERATION: 'REWARD_INVALID_OPERATION',

  // --- Payouts ------------------------------------------------------------
  PAYOUT_NOT_FOUND: 'PAYOUT_NOT_FOUND',
  /**
   * The requested transition is not permitted from the current status.
   *
   * Every state names its permitted successors and anything else is refused
   * (§11.1) — including a second approval of an already-approved request,
   * which would otherwise settle a lock twice.
   */
  PAYOUT_INVALID_TRANSITION: 'PAYOUT_INVALID_TRANSITION',
  /** Below the configured minimum or above the configured maximum (P3). */
  PAYOUT_AMOUNT_OUT_OF_RANGE: 'PAYOUT_AMOUNT_OUT_OF_RANGE',
  /** The method is not among the ones an admin has enabled (P3). */
  PAYOUT_METHOD_UNSUPPORTED: 'PAYOUT_METHOD_UNSUPPORTED',
  /** The payment destination is empty or not storable as given. */
  PAYOUT_DESTINATION_INVALID: 'PAYOUT_DESTINATION_INVALID',
  /** The configured daily cap on withdrawal requests has been reached (P3). */
  PAYOUT_DAILY_LIMIT_REACHED: 'PAYOUT_DAILY_LIMIT_REACHED',

  // --- Fraud --------------------------------------------------------------
  /** The referenced fraud evaluation does not exist. */
  FRAUD_EVALUATION_NOT_FOUND: 'FRAUD_EVALUATION_NOT_FOUND',
  /**
   * The conversion is not in a state a reviewer can resolve.
   *
   * Only a `HELD` conversion has a pending decision attached to it. Clearing
   * one already cleared would mature a credit twice.
   */
  FRAUD_CONVERSION_NOT_HELD: 'FRAUD_CONVERSION_NOT_HELD',

  // --- Configuration ------------------------------------------------------
  /** No definition is registered for this configuration key. */
  CONFIG_UNKNOWN_KEY: 'CONFIG_UNKNOWN_KEY',
  /** The value does not satisfy the key's registered schema. */
  CONFIG_INVALID_VALUE: 'CONFIG_INVALID_VALUE',
  /** The key is not defined at the requested scope. */
  CONFIG_INVALID_SCOPE: 'CONFIG_INVALID_SCOPE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Per-field detail, returned for validation failures only. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * The single error response shape for every endpoint.
 *
 * ARCHITECTURE.md §15.3: never carries a stack trace, an internal identifier,
 * a SQL fragment, or a provider's raw response. Full detail goes to the log,
 * joined to this response by `correlationId`.
 */
export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    correlationId: string;
    /** Present only for VALIDATION_FAILED. */
    fields?: FieldError[];
  };
}
