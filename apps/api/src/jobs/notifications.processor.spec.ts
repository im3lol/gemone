import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_JOBS, type VerificationEmailJobData } from '../core/queue/queue.constants';
import { EMAIL_TEMPLATES, type EmailMessage } from '../modules/notifications/email-provider';
import { NotificationsProcessor } from './notifications.processor';

const APP_URL = 'https://gemone.example';

function build(send: (message: EmailMessage) => Promise<void> = vi.fn(async () => undefined)) {
  const processor = new NotificationsProcessor({ send } as never, {
    PUBLIC_APP_URL: APP_URL,
  } as never);
  return { processor, send: send as ReturnType<typeof vi.fn> };
}

const job = (
  data: Partial<VerificationEmailJobData> = {},
  name: string = NOTIFICATION_JOBS.VERIFICATION_EMAIL,
) =>
  ({
    name,
    data: { userId: 'user-1', email: 'someone@example.test', token: 'the-token', ...data },
  }) as Job<VerificationEmailJobData>;

describe('NotificationsProcessor', () => {
  it('hands the address and template to the provider', async () => {
    const { processor, send } = build();

    await processor.process(job());

    const message = send.mock.calls[0]?.[0] as EmailMessage;
    expect(message.to).toBe('someone@example.test');
    expect(message.template).toBe(EMAIL_TEMPLATES.VERIFY_EMAIL);
    expect(message.params.url).toBe(`${APP_URL}/verify-email?token=the-token`);
  });

  it('sends a complete link built from the configured origin, never a bare token', async () => {
    /*
     * The recipient gets something they can click. A bare token is something
     * they have to find a form for — and the origin cannot be inferred by a
     * process sitting behind a proxy on an internal network.
     */
    const { processor, send } = build();

    await processor.process(job());

    const message = send.mock.calls[0]?.[0] as EmailMessage;
    expect(message.params.url!.startsWith(APP_URL)).toBe(true);
    expect(message.params.token).toBeUndefined();
  });

  it('encodes a token that contains URL-significant characters', async () => {
    // base64url avoids them today, and a change of encoding upstream should
    // not silently produce links that truncate at the first `&`.
    const { processor, send } = build();

    await processor.process(job({ token: 'a+b/c=d&e' }));

    const message = send.mock.calls[0]?.[0] as EmailMessage;
    expect(message.params.url).toBe(`${APP_URL}/verify-email?token=a%2Bb%2Fc%3Dd%26e`);
  });

  it('renders a reset job with the reset template, not the verification one', async () => {
    /*
     * The two payloads are the same shape, so nothing but the job name
     * distinguishes them — which makes sending a password reset that reads
     * "confirm your address" a one-character mistake with no type error.
     */
    const { processor, send } = build();

    await processor.process(job({}, NOTIFICATION_JOBS.PASSWORD_RESET_EMAIL));

    const message = send.mock.calls[0]?.[0] as EmailMessage;
    expect(message.template).toBe(EMAIL_TEMPLATES.RESET_PASSWORD);
    expect(message.params.url).toBe(`${APP_URL}/reset-password?token=the-token`);
  });

  it('lets a delivery failure escape, so the queue retries it', async () => {
    /*
     * The opposite of the balance queues, deliberately. A retried send can put
     * a second email in someone's inbox, which is a nuisance; a swallowed one
     * means an account nobody can verify and no record that anything failed.
     */
    const { processor } = build(
      vi.fn(async () => {
        throw new Error('delivery service refused');
      }),
    );

    await expect(processor.process(job())).rejects.toThrow('delivery service refused');
  });

  it('refuses a job name it was not taught', async () => {
    // One worker serves the whole queue, so an unrecognised name means a
    // producer this file does not know about — worth failing loudly.
    const { processor, send } = build();

    await expect(processor.process(job({}, 'some-other-job'))).rejects.toThrow(
      /Unknown notification job/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
