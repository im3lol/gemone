import * as Sentry from '@sentry/node';

// Initialise Sentry only when a DSN is configured; otherwise captureException is
// a safe no-op. Keeps secrets/DSN out of code (env-driven).
export function initSentry(dsn: string | undefined, environment: string): boolean {
  if (!dsn) return false;
  Sentry.init({ dsn, environment, tracesSampleRate: 0.1 });
  return true;
}

export { Sentry };
