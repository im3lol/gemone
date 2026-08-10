/**
 * Outbound email, behind an interface — ARCHITECTURE.md §7, P1.
 *
 * The same rule the offer providers follow: nothing above this line knows
 * which service actually delivers the message. `auth` asks for a verification
 * email; whether that becomes an SMTP conversation, an HTTP call to a delivery
 * service, or a line in a log is a decision that lives entirely below here.
 *
 * The message is a **template name plus parameters**, never a rendered body.
 * A caller that hands over rendered HTML has decided the format, the language
 * and the branding, and every future channel — a second language, a plain-text
 * fallback, an SMS — then has to be threaded back through that caller.
 */
export interface EmailMessage {
  /** Where it goes. Normalised by the caller; this layer does not interpret it. */
  to: string;

  /** Which template renders it. A closed set, so a typo is a type error. */
  template: EmailTemplate;

  /**
   * What the template needs, and nothing more.
   *
   * Deliberately `string` values only. A parameter that is an object is a
   * parameter whose shape a template silently depends on, and templates are
   * the part of this system most likely to be edited by someone who is not
   * reading the type.
   */
  params: Readonly<Record<string, string>>;
}

export const EMAIL_TEMPLATES = {
  VERIFY_EMAIL: 'verify-email',
  RESET_PASSWORD: 'reset-password',
} as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[keyof typeof EMAIL_TEMPLATES];

export interface EmailProvider {
  /**
   * Hands one message to the delivery mechanism.
   *
   * Throwing means "not accepted" and is expected to be retried by the caller
   * — which is a job, not a request. Nothing on the request path calls this.
   */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Injection token for the single configured provider.
 *
 * A token rather than a class, because the whole point is that the consumer
 * names the capability and not the implementation (§7.3).
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
