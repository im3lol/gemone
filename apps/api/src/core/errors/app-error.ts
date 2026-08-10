import { ERROR_CODES, type ErrorCode, type FieldError } from '@gemone/contracts';

/**
 * The error taxonomy — ARCHITECTURE.md §15.1.
 *
 * Three families, and everything thrown in this codebase belongs to exactly
 * one of them. The distinction is not cosmetic: it decides the HTTP status,
 * the log level, and whether a retry could plausibly succeed.
 *
 * The families are separated because collapsing them means either logging
 * expected business outcomes as errors — which trains everyone to ignore the
 * error log — or returning 400 for "insufficient balance", which tells the
 * client to fix a request that has nothing wrong with it.
 */
export type ErrorFamily = 'validation' | 'domain' | 'infrastructure';

/** Log level this error should be recorded at (§15.1 table). */
export type ErrorLogLevel = 'debug' | 'info' | 'error';

export abstract class AppError extends Error {
  abstract readonly family: ErrorFamily;
  abstract readonly httpStatus: number;
  abstract readonly logLevel: ErrorLogLevel;

  /**
   * Whether a retry of the identical operation could plausibly succeed.
   * Job processing reads this to decide between a retry and an immediate
   * failure (§15.4) — retrying a non-retryable failure just delays the alert.
   */
  abstract readonly retryable: boolean;

  readonly code: ErrorCode;

  /**
   * Structured detail for the log only. Never serialised into a response
   * (§15.3) — the response carries the code, a safe message, and the
   * correlation id that joins it to this context in the log.
   */
  readonly context?: Record<string, unknown>;

  protected constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * The caller sent something invalid. Not retryable — the same input will fail
 * the same way.
 */
export class ValidationError extends AppError {
  readonly family = 'validation' as const;
  readonly httpStatus = 422;
  readonly logLevel = 'debug' as const;
  readonly retryable = false;

  /** Per-field detail. The only error family that exposes any (§15.3). */
  readonly fields: FieldError[];

  constructor(
    message = 'Validation failed',
    fields: FieldError[] = [],
    context?: Record<string, unknown>,
  ) {
    super(ERROR_CODES.VALIDATION_FAILED, message, context);
    this.fields = fields;
  }
}

/**
 * The request is well-formed but the rules forbid it: insufficient balance,
 * an invalid state transition, a limit exceeded.
 *
 * Logged at `info`, because it is an expected outcome of a correctly working
 * system — not a fault.
 */
export class DomainError extends AppError {
  readonly family = 'domain' as const;
  readonly logLevel = 'info' as const;
  readonly retryable = false;
  readonly httpStatus: number;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus = 409,
    context?: Record<string, unknown>,
  ) {
    super(code, message, context);
    this.httpStatus = httpStatus;
  }
}

/**
 * Something we depend on failed: the database, Redis, a provider API.
 * Usually retryable — but the caller decides, because "the database is down"
 * and "this provider rejected our credentials" want different handling.
 */
export class InfrastructureError extends AppError {
  readonly family = 'infrastructure' as const;
  readonly logLevel = 'error' as const;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      httpStatus?: number;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(
      options.code ?? ERROR_CODES.INTERNAL_ERROR,
      message,
      options.context,
    );
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? true;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
