/**
 * Values that belong in the ConfigurationService (P3) but do not have one yet.
 *
 * ARCHITECTURE.md §24 sequences M1 as skeleton → configuration service →
 * authentication, precisely so that no business rule is ever written as a
 * literal. Authentication was built first, so these are constants.
 *
 * They are gathered in one file, and each is read from exactly one place, so
 * migrating them is a mechanical change rather than a hunt. That is the
 * mitigation, not an excuse — P3 says code may define defaults but never the
 * value in force, and today these ARE the value in force.
 *
 * TO MIGRATE (when ConfigurationService lands):
 *   - PASSWORD_POLICY  → read in PasswordService.assertMeetsPolicy()  (TODO T1)
 *
 * The login throttling thresholds §8.3 requires were never added here. They
 * arrived in Feature 17 as configuration keys from the start — see
 * `auth.config.ts` — which is what waiting for the configuration service
 * bought. `PASSWORD_POLICY` is the only value in this file still standing
 * where P3 says it should not.
 */

export const PASSWORD_POLICY = {
  /**
   * Length only. No character-class rules: they push users toward
   * "Password1!" and measurably reduce entropy, which is why NIST dropped
   * the recommendation. Length is what actually helps.
   */
  minLength: 12,

  /**
   * Bounded because argon2 hashes whatever it is given — an unbounded
   * password is an unbounded amount of CPU per login attempt, which is a
   * denial-of-service vector rather than a security feature.
   */
  maxLength: 256,
} as const;

/**
 * The cookie carrying the refresh token.
 *
 * Scoped to `/auth` so it is never sent to any other endpoint. A cookie that
 * accompanies every request is a cookie exposed on every request.
 */
export const REFRESH_COOKIE_NAME = 'gemone_rt';
export const REFRESH_COOKIE_PATH = '/auth';

/** Reasons written to `refresh_tokens.revoked_reason`. */
export const REVOCATION_REASONS = {
  LOGOUT: 'logout',
  ROTATED: 'rotated',
  REUSE_DETECTED: 'reuse_detected',

  /**
   * A password was reset through the emailed link.
   *
   * Every session goes, not just the one that asked — nobody asks to reset a
   * password they can still use, so the population of live sessions at that
   * moment is exactly the population of sessions the user wants gone.
   */
  PASSWORD_RESET: 'password_reset',
} as const;
