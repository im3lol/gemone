import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `clicks` module — P3.
 *
 * PROJECT.md §4.3 requires the attribution window to be configurable, and its
 * P3 list names "daily limits (earnings, clicks, ...)". These are those
 * values.
 */

/**
 * How long a click stays attributable.
 *
 * Per provider as well as globally, because networks differ in how long they
 * take to report a conversion — a window that is generous for a fast network
 * is a window in which we accept stale, unverifiable conversions from it, and
 * a window that is right for a slow network is one where we refuse conversions
 * users genuinely earned.
 *
 * The resolved value is **stored on the click**, so changing this affects new
 * clicks only. See the column comment for why that is structural rather than a
 * rule someone has to remember.
 */
export const CLICKS_ATTRIBUTION_WINDOW_DAYS: ConfigurationKeyDefinition<number> = {
  key: 'clicks.attribution_window_days',
  schema: z.number().int().min(1).max(365),
  defaultValue: 30,
  description: 'Days a click remains attributable to an incoming conversion',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * The per-user click ceiling, per hour.
 *
 * ARCHITECTURE.md §19.5's third layer: a fraud control, not an HTTP throttle.
 * It defends against behaviour that is *economically* damaging while sitting
 * well inside normal request rates — a script clicking every offer on the wall
 * in sequence looks unremarkable to a rate limiter and burns a provider's
 * click budget, which is how an integration gets terminated.
 *
 * GLOBAL only. It describes what a person may do, not what a provider allows,
 * so a per-provider value would be a limit that means different things
 * depending on which offer someone happened to click.
 */
export const CLICKS_MAX_PER_USER_PER_HOUR: ConfigurationKeyDefinition<number> = {
  key: 'clicks.max_per_user_per_hour',
  schema: z.number().int().min(1).max(10_000),
  defaultValue: 60,
  description: 'Maximum clicks one user may make in a rolling hour',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * The per-IP click ceiling, per hour.
 *
 * Deliberately looser than the per-user limit and deliberately separate from
 * it: several genuine users share an address behind a university, an office or
 * a mobile carrier NAT, so this cannot be tight. What it catches is the case
 * the per-user limit cannot see at all — one actor spreading clicks across
 * many freshly registered accounts, which is the shape multi-accounting takes.
 */
export const CLICKS_MAX_PER_IP_PER_HOUR: ConfigurationKeyDefinition<number> = {
  key: 'clicks.max_per_ip_per_hour',
  schema: z.number().int().min(1).max(100_000),
  defaultValue: 300,
  description: 'Maximum clicks from one IP address in a rolling hour',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/** Registered as a list, so adding a key is one edit rather than two. */
export const CLICKS_CONFIGURATION_KEYS: readonly ConfigurationKeyDefinition[] = [
  CLICKS_ATTRIBUTION_WINDOW_DAYS,
  CLICKS_MAX_PER_USER_PER_HOUR,
  CLICKS_MAX_PER_IP_PER_HOUR,
];
