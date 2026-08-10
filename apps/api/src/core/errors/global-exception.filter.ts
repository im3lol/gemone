import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  ERROR_CODES,
  type ApiErrorResponse,
  type ErrorCode,
  type FieldError,
} from '@gemone/contracts';
import type { Request, Response } from 'express';

import { AppError, isAppError, type ErrorLogLevel } from './app-error';
import { CORRELATION_ID_HEADER, getCorrelationId } from '../logging/correlation';

/**
 * The one place where an exception becomes an HTTP response — §15.5.
 *
 * Everything unrecognised becomes a 500 with a generic message and is logged
 * with its full stack. Nothing here leaks internals to the client (§15.3):
 * the response carries a stable code, a safe message, and the correlation id
 * that joins it to the full detail in the log.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const correlationId = getCorrelationId(request);
    const mapped = this.map(exception);

    this.log(mapped.logLevel, exception, {
      correlationId,
      code: mapped.code,
      status: mapped.httpStatus,
      method: request.method,
      path: request.url,
      context: mapped.context,
    });

    const body: ApiErrorResponse = {
      error: {
        code: mapped.code,
        message: mapped.message,
        correlationId,
        ...(mapped.fields && mapped.fields.length > 0
          ? { fields: mapped.fields }
          : {}),
      },
    };

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.status(mapped.httpStatus).json(body);
  }

  private map(exception: unknown): {
    code: ErrorCode;
    message: string;
    httpStatus: number;
    logLevel: ErrorLogLevel;
    fields?: FieldError[];
    context?: Record<string, unknown>;
  } {
    if (isAppError(exception)) {
      return {
        code: exception.code,
        message: exception.message,
        httpStatus: exception.httpStatus,
        logLevel: exception.logLevel,
        fields: 'fields' in exception ? (exception.fields as FieldError[]) : undefined,
        context: exception.context,
      };
    }

    // Nest's own exceptions (including those raised by guards, pipes and the
    // router) carry a usable status; their messages are framework-generated
    // and safe to pass through.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        code: httpStatusToCode(status),
        message: extractHttpExceptionMessage(exception),
        httpStatus: status,
        logLevel: status >= 500 ? 'error' : 'debug',
      };
    }

    // Anything else is a bug. Generic message out, full stack to the log.
    return {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      httpStatus: 500,
      logLevel: 'error',
    };
  }

  private log(
    level: ErrorLogLevel,
    exception: unknown,
    meta: Record<string, unknown>,
  ): void {
    const description = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    switch (level) {
      case 'error':
        this.logger.error({ ...meta, err: description }, stack);
        break;
      case 'info':
        this.logger.log({ ...meta, err: description });
        break;
      case 'debug':
        this.logger.debug({ ...meta, err: description });
        break;
    }
  }
}

function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
  }
}

function extractHttpExceptionMessage(exception: HttpException): string {
  const payload = exception.getResponse();

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload as { message: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }

  return exception.message;
}

/** Exported for the exception filter's own tests. */
export const __testing = { httpStatusToCode, extractHttpExceptionMessage };

// Referenced so the abstract base is part of this module's public typing
// surface for consumers that catch on it.
export type { AppError };
