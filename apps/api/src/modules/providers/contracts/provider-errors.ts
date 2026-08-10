import { ERROR_CODES } from '@gemone/contracts';

import { InfrastructureError } from '../../../core/errors/app-error';

/**
 * The normalized adapter failure set — ARCHITECTURE.md §7.2, rule 4.
 *
 * Four errors, and every adapter maps whatever its network does into exactly
 * one of them. The point is that callers react without knowing which provider
 * failed: the sync job retries a `ProviderUnavailableError`, backs off on a
 * `ProviderRateLimitedError`, and pages someone on a `ProviderAuthFailedError`
 * — decisions it can make with no `if (slug === ...)` anywhere (§5, rule 7).
 *
 * All four are `InfrastructureError`, because from our side a provider *is*
 * infrastructure we depend on. The `retryable` flag is where they differ, and
 * it is the flag job processing actually reads (§15.4).
 */
export abstract class ProviderError extends InfrastructureError {
  /**
   * Which provider failed. Log context only — never serialised into a
   * response (§15.3), because a user seeing "acme returned 500" learns the
   * name of a network they have no relationship with.
   */
  readonly providerSlug: string;

  protected constructor(
    providerSlug: string,
    message: string,
    options: ConstructorParameters<typeof InfrastructureError>[1],
  ) {
    super(message, options);
    this.providerSlug = providerSlug;
  }
}

/** The provider is unreachable, timed out, or returned a 5xx. Retry later. */
export class ProviderUnavailableError extends ProviderError {
  constructor(providerSlug: string, message: string, cause?: unknown) {
    super(providerSlug, message, {
      code: ERROR_CODES.PROVIDER_UNAVAILABLE,
      httpStatus: 503,
      retryable: true,
      context: { providerSlug },
      cause,
    });
  }
}

/**
 * We are being throttled.
 *
 * Distinct from unavailable even though both are retryable, because the right
 * retry is different: unavailability wants a prompt retry, throttling wants a
 * longer backoff, and retrying a rate limit immediately extends it.
 */
export class ProviderRateLimitedError extends ProviderError {
  /** Seconds the provider asked us to wait, when it said. */
  readonly retryAfterSeconds: number | null;

  constructor(
    providerSlug: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(providerSlug, message, {
      code: ERROR_CODES.PROVIDER_RATE_LIMITED,
      httpStatus: 429,
      retryable: true,
      context: { providerSlug, retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Our credentials were rejected.
 *
 * NOT retryable, deliberately. The same key will be rejected the same way,
 * and a retry loop against an auth failure is how an account gets locked for
 * abuse — turning a configuration problem into an outage.
 */
export class ProviderAuthFailedError extends ProviderError {
  constructor(providerSlug: string, message: string) {
    super(providerSlug, message, {
      code: ERROR_CODES.PROVIDER_AUTH_FAILED,
      httpStatus: 502,
      retryable: false,
      context: { providerSlug },
    });
  }
}

/**
 * The provider answered, and we could not make sense of it.
 *
 * Not retryable: a deterministic response will parse identically next time.
 * This is the error that catches provider format drift, which is what the
 * fixtures in §7.2 rule 6 exist to catch first.
 */
export class ProviderResponseInvalidError extends ProviderError {
  constructor(
    providerSlug: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(providerSlug, message, {
      code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      httpStatus: 502,
      retryable: false,
      context: { providerSlug, ...context },
    });
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
