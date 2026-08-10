/**
 * Everything the engine is allowed to know — ARCHITECTURE.md §4.2.
 *
 * *"`fraud` receives everything it needs as a plain input object. The caller
 * assembles the evaluation context (user, click, conversion, recent velocity
 * counters) and passes it in; `fraud` reads configuration, applies rules, and
 * returns a score plus a recommended action. It imports no business module."*
 *
 * This file is the whole reason that holds. Every field here is a primitive or
 * a date — no Prisma model, no service, nothing that would drag a module import
 * in behind it. The engine is therefore testable with object literals, and a
 * historical decision can be replayed later by reconstructing one of these.
 *
 * **Nullable fields are nullable on purpose.** A click can legitimately carry
 * no IP and no fingerprint (§3.3), and a rule with no input must record that it
 * could not run rather than quietly scoring zero.
 */
export interface FraudEvaluationContext {
  userId: string;

  /** Scopes the configuration lookup (P3, PROVIDER → GLOBAL). */
  providerId: string;

  /** Lowercased domain of the account's registration email, without the `@`. */
  emailDomain: string | null;

  /** When the account was created. */
  accountCreatedAt: Date;

  /** The click this conversion is attributed to. */
  clickAt: Date;
  clickIp: string | null;
  clickDeviceFingerprint: string | null;

  /** When the provider says the conversion happened, or when we heard about it. */
  conversionAt: Date;

  /** Conversions by this user inside the velocity window. */
  userConversionsInWindow: number;

  /**
   * Conversions from this click's IP inside the velocity window.
   *
   * Null when the click carries no IP — distinct from zero, which would mean
   * "an IP we know, with no conversions".
   */
  ipConversionsInWindow: number | null;

  /** Distinct accounts seen from this IP inside the shared-identity window. */
  accountsSharingIp: number | null;

  /** Distinct accounts seen from this fingerprint inside the same window. */
  accountsSharingDevice: number | null;

  /** This user's lifetime conversion count, excluding reversal rows. */
  lifetimeConversions: number;

  /** How many of those were reversed. */
  lifetimeChargebacks: number;
}
