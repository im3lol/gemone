import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `auth` module — P3, ARCHITECTURE.md §8.3.
 *
 * §8.3 requires login throttling to be "per-account and per-IP, backed by
 * Redis, thresholds configurable (P3)". These are those thresholds, and they
 * are the reason TODO T2 waited for the configuration service rather than
 * shipping with the numbers written into the code.
 *
 * GLOBAL only, all four. A per-provider login threshold would be a value that
 * means nothing — logging in is not something a provider is involved in.
 */

/**
 * Failed attempts against one account before it is refused.
 *
 * Counted per account rather than per session because the attack this stops
 * spreads across sessions by definition. Deliberately not tiny: a legitimate
 * user mistyping a password three times in a row is ordinary, and a limit that
 * catches them is a support ticket generator rather than a control.
 */
export const AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT: ConfigurationKeyDefinition<number> = {
  key: 'auth.login_max_failures_per_account',
  schema: z.number().int().min(1).max(1_000),
  defaultValue: 10,
  description: 'Failed login attempts against one account before it is throttled',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/** How long the per-account failure count is remembered, in seconds. */
export const AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS: ConfigurationKeyDefinition<number> = {
  key: 'auth.login_account_window_seconds',
  schema: z.number().int().min(60).max(86_400),
  defaultValue: 900,
  description: 'Rolling window over which per-account login failures are counted',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * Failed attempts from one address before it is refused.
 *
 * **Deliberately looser than the per-account limit**, for the reason the click
 * limits give: a university, an office and a mobile carrier NAT put many
 * genuine users behind one address, and several of them will fail a login on
 * any given morning. What this catches is what the account limit cannot see —
 * one actor working through a list of addresses, a few attempts each, never
 * tripping any single account's ceiling.
 */
export const AUTH_LOGIN_MAX_FAILURES_PER_IP: ConfigurationKeyDefinition<number> = {
  key: 'auth.login_max_failures_per_ip',
  schema: z.number().int().min(1).max(10_000),
  defaultValue: 50,
  description: 'Failed login attempts from one IP address before it is throttled',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/** How long the per-IP failure count is remembered, in seconds. */
export const AUTH_LOGIN_IP_WINDOW_SECONDS: ConfigurationKeyDefinition<number> = {
  key: 'auth.login_ip_window_seconds',
  schema: z.number().int().min(60).max(86_400),
  defaultValue: 900,
  description: 'Rolling window over which per-IP login failures are counted',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * How long an address-verification link stays usable, in seconds.
 *
 * A day by default. §8.3 says "short expiry", and short here is bounded from
 * below by how people actually read email: an hour catches anyone who
 * registers in the evening and opens their inbox the next morning, and the
 * only recovery from an expired link is to ask for another one.
 */
export const AUTH_EMAIL_VERIFICATION_TTL_SECONDS: ConfigurationKeyDefinition<number> = {
  key: 'auth.email_verification_ttl_seconds',
  schema: z.number().int().min(300).max(604_800),
  defaultValue: 86_400,
  description: 'How long an email verification link remains valid',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * How long a password-reset link stays usable, in seconds.
 *
 * An hour by default — a quarter of the verification link's day, and
 * deliberately so. The two tokens are the same mechanism with very different
 * consequences: a stale verification link marks an address confirmed, a stale
 * reset link takes over an account. This one is also *asked for*, so the user
 * is at their inbox when it arrives rather than reading it tomorrow morning.
 */
export const AUTH_PASSWORD_RESET_TTL_SECONDS: ConfigurationKeyDefinition<number> = {
  key: 'auth.password_reset_ttl_seconds',
  schema: z.number().int().min(300).max(86_400),
  defaultValue: 3_600,
  description: 'How long a password reset link remains valid',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * Requests one address may make to a single public auth endpoint per window.
 *
 * **Counts requests, not failures** — which is what makes it a different
 * control from the login throttle above rather than a copy of it. The login
 * counters exist to stop password guessing, so a correct password gives its
 * place back; these exist to stop an endpoint being *used* too much, and
 * success is exactly what the abuse looks like: an address that registers a
 * thousand accounts, or asks for a thousand password-reset emails to somebody
 * else's inbox, does so with perfectly valid requests every time.
 *
 * **Per endpoint, so one bucket cannot exhaust another.** Registering does not
 * consume the allowance for refreshing a session.
 *
 * Twenty is generous for a person and useless for a script: a user who mistypes
 * their address, asks for a new link, and retries has room several times over,
 * while an email flood is bounded at twenty per five minutes per address
 * instead of unbounded. Raise it if a legitimate NAT complains; it is
 * configuration for exactly that reason (P3).
 */
export const AUTH_PUBLIC_MAX_REQUESTS_PER_IP: ConfigurationKeyDefinition<number> = {
  key: 'auth.public_max_requests_per_ip',
  schema: z.number().int().min(1).max(10_000),
  defaultValue: 20,
  description:
    'Requests one IP address may make to a single public auth endpoint per window',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/** How long the per-endpoint request count is remembered, in seconds. */
export const AUTH_PUBLIC_IP_WINDOW_SECONDS: ConfigurationKeyDefinition<number> = {
  key: 'auth.public_ip_window_seconds',
  schema: z.number().int().min(60).max(86_400),
  defaultValue: 300,
  description: 'Rolling window over which public auth requests from one IP are counted',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/** Registered as a list, so adding a key is one edit rather than two. */
export const AUTH_CONFIGURATION_KEYS: readonly ConfigurationKeyDefinition[] = [
  AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT,
  AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS,
  AUTH_LOGIN_MAX_FAILURES_PER_IP,
  AUTH_LOGIN_IP_WINDOW_SECONDS,
  AUTH_EMAIL_VERIFICATION_TTL_SECONDS,
  AUTH_PASSWORD_RESET_TTL_SECONDS,
  AUTH_PUBLIC_MAX_REQUESTS_PER_IP,
  AUTH_PUBLIC_IP_WINDOW_SECONDS,
];
