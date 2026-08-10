import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { type Env, loadEnv } from '../config/env.schema';
import { CORRELATION_ID_HEADER, getCorrelationId } from './correlation';

/**
 * Structured logging — ARCHITECTURE.md §16.
 *
 * JSON to stdout, collected by the container runtime. Writing files inside a
 * container would mean managing rotation, disk and permissions to solve a
 * problem the platform already solved.
 */

/**
 * Redaction deny-list — §16.4.
 *
 * Configured at startup rather than applied at each call site, so it holds
 * even when a future developer logs a whole object without thinking. That is
 * the entire point: the protection cannot depend on the person writing the
 * log line remembering it.
 *
 * Deliberately NOT redacted: IP addresses and device fingerprints. They are
 * fraud signals and operationally necessary; they are handled as personal
 * data with a retention limit instead.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.totpCode',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.refreshToken',
  '*.accessToken',
  '*.totpSecret',
  '*.apiKey',
  '*.secret',
];

function buildOptions(env: Env) {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,

      // The correlation id IS the request id — one identifier, not two.
      genReqId: (req: unknown) => getCorrelationId(req),

      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },

      // Levels follow §16.3's definitions literally.
      //
      // 4xx maps to `info`, not `warn`. A 404 or a rejected payload is an
      // expected outcome of a public API — it is neither "degraded but
      // handled" (what warn means here) nor actionable (what error means).
      // Logging every 404 at warn makes warn noise, and a noisy level is a
      // muted level.
      customLogLevel: (_req: unknown, res: { statusCode: number }, err?: unknown) => {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        return 'info';
      },

      // Keep request/response logging to the fields that answer operational
      // questions. Full header dumps are noise that also widens the redaction
      // surface.
      serializers: {
        req: (req: {
          id: string;
          method: string;
          url: string;
          remoteAddress?: string;
        }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({
          statusCode: res.statusCode,
        }),
      },

      // pino-http binds the request id to the child logger every service
      // resolves, so renaming it here is what puts `correlationId` on
      // application log lines too — not just on request-completion lines.
      customAttributeKeys: { reqId: 'correlationId' },

      // Pretty printing is for a human at a terminal. Production emits JSON.
      transport: env.LOG_PRETTY
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
          }
        : undefined,
    },
  };
}

@Module({
  imports: [LoggerModule.forRootAsync({ useFactory: () => buildOptions(loadEnv()) })],
})
export class LoggingModule {}

export { CORRELATION_ID_HEADER, REDACTED_PATHS };
