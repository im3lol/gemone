import { Module } from '@nestjs/common';

import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider';
import { LoggingEmailProvider } from './logging-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Outbound notification, behind one interface — ARCHITECTURE.md §7.
 *
 * It exports the token, not the class. A consumer that can name
 * `LoggingEmailProvider` is a consumer that can come to depend on it.
 *
 * **Which implementation is decided by whether SMTP is configured.** There is
 * no separate switch: `SMTP_HOST` present means real delivery, absent means the
 * log. A flag alongside the credentials would be a second thing to set and a
 * second thing to set wrongly — and the failure mode of getting it wrong is
 * silence, which is the failure mode nobody notices (P6).
 *
 * Development therefore keeps working with nothing configured, which is what
 * makes the flow completable without a mail account (P4).
 */
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ENV],
      useFactory: resolveEmailProvider,
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class NotificationsModule {}

/**
 * The choice itself, as a function so it can be tested without a module graph.
 *
 * `SMTP_HOST` is the switch, and in production the environment schema refuses
 * to boot without one — so the logging branch is reachable only where writing
 * a reset link to the log is a development convenience rather than a way to
 * hand over accounts.
 */
export function resolveEmailProvider(env: Env): EmailProvider {
  return env.SMTP_HOST ? new SmtpEmailProvider(env) : new LoggingEmailProvider();
}
