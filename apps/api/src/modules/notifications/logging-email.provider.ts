import { Injectable, Logger } from '@nestjs/common';

import type { EmailMessage, EmailProvider } from './email-provider';

/**
 * The only implementation there is — it writes the message to the log.
 *
 * The same shape `ManualPayoutProvider` and `MockProvider` take, and for the
 * same reason: one real interface with one honest implementation is what keeps
 * the abstraction from being designed against an imaginary second case. When a
 * delivery service is chosen it becomes a sibling of this file and nothing
 * above `EmailProvider` changes.
 *
 * **It is not a stub.** In development and in the test suite this is how a
 * verification link is obtained, so the flow is genuinely completable end to
 * end without a mail server, an account with a delivery service, or a
 * credential in anyone's environment (P4).
 */
@Injectable()
export class LoggingEmailProvider implements EmailProvider {
  private readonly logger = new Logger(LoggingEmailProvider.name);

  async send(message: EmailMessage): Promise<void> {
    /*
     * Structured, and the parameters are spread rather than nested, so the
     * verification link is greppable in a log aggregator rather than buried in
     * a serialised object.
     *
     * The recipient is logged in full. That is a deliberate cost of this
     * provider being a development tool: a real one records delivery in
     * `email_log` and has no reason to put an address in the application log.
     */
    this.logger.log(
      { to: message.to, template: message.template, ...message.params },
      'Email delivered to the log',
    );
  }
}
