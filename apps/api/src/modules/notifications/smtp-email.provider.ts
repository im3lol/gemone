import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import { EMAIL_TEMPLATES, type EmailMessage, type EmailProvider } from './email-provider';

/**
 * Real delivery over SMTP — ARCHITECTURE.md §7, P1.
 *
 * The second implementation of `EmailProvider`, and nothing above this line
 * changed to accommodate it: `auth` still asks for a verification email, and
 * the processor still hands over a template name and parameters.
 *
 * SMTP rather than a delivery service's HTTP API, because every provider
 * speaks it — switching from one to another is a change of host and
 * credentials rather than a new adapter (P1, P4).
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleDestroy {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; everything else negotiates STARTTLS.
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER && env.SMTP_PASSWORD
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    const { subject, body } = render(message);

    await this.transport.sendMail({
      from: this.env.SMTP_FROM,
      to: message.to,
      subject,
      text: body,
    });

    /*
     * The recipient and the template, never the parameters.
     *
     * The parameters carry the link, and the link carries a single-use token
     * that is the whole credential — logging it would put in our logs exactly
     * what the hashing in `verification_tokens` exists to keep out of them.
     */
    this.logger.log({ to: message.to, template: message.template }, 'Email sent');
  }

  async onModuleDestroy(): Promise<void> {
    this.transport.close();
  }
}

/**
 * Subject and body for one message.
 *
 * Plain text, and deliberately so for the MVP: an HTML mail wants a layout, an
 * inliner and a text fallback, and none of that changes whether the link works.
 */
function render(message: EmailMessage): { subject: string; body: string } {
  const url = message.params.url ?? '';

  switch (message.template) {
    case EMAIL_TEMPLATES.VERIFY_EMAIL:
      return {
        subject: 'Confirm your email address',
        body: `Welcome.\n\nConfirm your email address by opening this link:\n\n${url}\n\nIf you did not create an account, ignore this message.\n`,
      };

    case EMAIL_TEMPLATES.RESET_PASSWORD:
      return {
        subject: 'Reset your password',
        body: `Someone asked to reset your password.\n\nChoose a new one here:\n\n${url}\n\nIf that was not you, ignore this message — nothing has changed.\n`,
      };
  }
}
