import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../core/config/env.schema';
import { LoggingEmailProvider } from './logging-email.provider';
import { resolveEmailProvider } from './notifications.module';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Which provider gets resolved, and by what.
 *
 * The pair below is the whole contract: absence of a host means the log, and
 * production is not allowed to be absent. Asserted against `loadEnv` rather
 * than a hand-built object, so a change to the schema that made the production
 * branch reachable again would fail here too.
 */
const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  CLICK_SIGNING_SECRET: 'b'.repeat(32),
};

describe('resolveEmailProvider', () => {
  it('uses the logging provider in development with nothing configured', () => {
    // P4: the verification flow stays completable without a mail account.
    const env = loadEnv({ ...BASE, NODE_ENV: 'development' } as NodeJS.ProcessEnv);

    expect(resolveEmailProvider(env)).toBeInstanceOf(LoggingEmailProvider);
  });

  it('uses SMTP in production, where a host is mandatory', () => {
    const env = loadEnv({
      ...BASE,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'gemone <no-reply@example.com>',
      // Production requires these to agree; this suite is about the provider.
      SITE_ADDRESS: 'gemone.example',
      PUBLIC_APP_URL: 'https://gemone.example',
    } as NodeJS.ProcessEnv);

    expect(resolveEmailProvider(env)).toBeInstanceOf(SmtpEmailProvider);
  });

  it('cannot be reached with the logging provider in production', () => {
    /*
     * The guarantee, stated as the thing that must remain impossible: a
     * production process that resolves `LoggingEmailProvider` is one writing
     * password-reset links into its own log. The environment refuses to load
     * long before this function is called.
     */
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /SMTP_HOST is required in production/,
    );
  });
});
