import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ENV } from '../core/config/env.module';
import type { Env } from '../core/config/env.schema';

import {
  NOTIFICATION_JOBS,
  QUEUES,
  type PasswordResetEmailJobData,
  type VerificationEmailJobData,
} from '../core/queue/queue.constants';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  EMAIL_TEMPLATES,
  type EmailProvider,
} from '../modules/notifications/email-provider';

/** Every payload this queue carries. Each handler names the one it wants. */
type NotificationJobData = VerificationEmailJobData | PasswordResetEmailJobData;

interface NotificationHandler {
  /** What the dispatch log line calls this notification. */
  label: string;

  /**
   * Turns one payload into the message to send. Owns its own parameters.
   *
   * `appUrl` is the configured public origin. Handlers build **complete links**
   * from it rather than passing the token through: a token on its own is
   * something the recipient has to paste somewhere, and every provider that
   * has ever sent one has ended up sending a link instead.
   */
  build(data: NotificationJobData, appUrl: string): EmailMessage;
}

/**
 * Declares one job's handler.
 *
 * The cast inside is contained here, and this is the honest place for one: job
 * data arrives as JSON from Redis, so `Job<T>`'s type parameter is an
 * assertion rather than a check however this file is written. Narrowing once,
 * at the point where the job *name* has already determined which payload it
 * is, beats every handler re-narrowing the same union.
 */
function handler<TData extends NotificationJobData>(
  label: string,
  build: (data: TData, appUrl: string) => EmailMessage,
): NotificationHandler {
  return { label, build: build as NotificationHandler['build'] };
}

/**
 * One row per job name — **adding a notification type is adding a row here.**
 *
 * A table rather than a `switch`, and the difference is not stylistic. The
 * switch this replaced routed both jobs through one shared `deliver()` that
 * built `params` itself, which worked only because both payloads happen to
 * carry exactly a token. The first notification whose email needs anything
 * else — a payout amount, a reference, a rejection reason — would have had to
 * change that shared method, and changing it means touching the code path that
 * delivers verification and reset emails in order to add an unrelated one.
 *
 * Here each row builds its own message and shares nothing with its neighbours,
 * so a new one cannot break an existing one. What is still shared is the part
 * that genuinely is common to all of them: send it, log it, let failures
 * escape.
 *
 * Handlers live in this file rather than in the modules that enqueue the jobs.
 * Module-side registration would make this table unnecessary, at the price of
 * a registry whose contents depend on which modules loaded — and the worker
 * would then fail to deliver, silently, for a producer that forgot to
 * register. One table that is wrong loudly beats a registry that is wrong
 * quietly (P6).
 */
const HANDLERS: Readonly<Record<string, NotificationHandler>> = {
  [NOTIFICATION_JOBS.VERIFICATION_EMAIL]: handler(
    'Verification',
    (data: VerificationEmailJobData, appUrl: string): EmailMessage => ({
      to: data.email,
      template: EMAIL_TEMPLATES.VERIFY_EMAIL,
      params: { url: link(appUrl, '/verify-email', data.token) },
    }),
  ),

  [NOTIFICATION_JOBS.PASSWORD_RESET_EMAIL]: handler(
    'Password reset',
    (data: PasswordResetEmailJobData, appUrl: string): EmailMessage => ({
      to: data.email,
      template: EMAIL_TEMPLATES.RESET_PASSWORD,
      params: { url: link(appUrl, '/reset-password', data.token) },
    }),
  ),
};

/**
 * One place that builds a link, so every one of them uses the configured
 * origin and encodes its token.
 */
function link(appUrl: string, path: string, token: string): string {
  return `${appUrl}${path}?token=${encodeURIComponent(token)}`;
}

/**
 * Delivers outbound email — ARCHITECTURE.md §8.3, §12.
 *
 * On a queue rather than in the request, because delivery is an outbound call
 * to something that can be slow, throttled or down, and a registration that
 * waits for it is a registration that fails when a mail service does.
 *
 * **Failures are retryable and are allowed to be.** Unlike the balance queues,
 * a duplicated send here is a second email in someone's inbox rather than a
 * second credit — so this processor lets the error escape and BullMQ's retry
 * policy do its work, instead of swallowing it to protect an invariant that
 * does not exist.
 *
 * **One processor for the whole queue, dispatching by job name.** Not a
 * stylistic choice: a second `@Processor(QUEUES.NOTIFICATIONS)` would start a
 * second worker *competing for the same jobs*, so a reset email would be
 * delivered by whichever worker won the race — and rejected as unknown by the
 * other, half the time.
 *
 * The class itself holds no per-notification knowledge; it looks the job up in
 * `HANDLERS` and does what is common to all of them. That is what keeps it
 * from growing a branch per notification type as the platform gains them.
 */
@Injectable()
@Processor(QUEUES.NOTIFICATIONS, {
  /*
   * Five. Delivery is IO-bound and waiting on someone else's service, so
   * serialising it buys nothing — and the ceiling exists because the eventual
   * provider will have a rate limit, which is a better thing to discover as
   * queue depth than as a block.
   */
  concurrency: 5,
})
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const notification = HANDLERS[job.name];

    if (!notification) {
      // One worker serves the queue, so an unrecognised name means a producer
      // this file has not been taught about — louder than silently succeeding.
      throw new Error(`Unknown notification job: ${job.name}`);
    }

    await this.email.send(notification.build(job.data, this.env.PUBLIC_APP_URL));

    this.logger.log({ userId: job.data.userId }, `${notification.label} email dispatched`);
  }
}
