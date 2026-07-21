import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Sentry } from './sentry';

// Logs every unhandled/HTTP exception (structured, via the app logger) and
// reports 5xx to Sentry (no-op unless a DSN is configured).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      Sentry.captureException(exception);
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.log.error(`${req.method} ${req.url} -> ${status}`, stack);
    }

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };
    res.status(status).json(typeof payload === 'string' ? { statusCode: status, message: payload } : payload);
  }
}
