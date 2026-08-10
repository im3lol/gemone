import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `payouts` module — P3.
 *
 * PROJECT.md §1's P3 list names "withdrawal limits (minimum, maximum,
 * per-method)" and "daily limits" explicitly, and §4.6 adds that payout
 * *methods* are configuration too: "adding a payment method an admin can settle
 * manually requires no deployment."
 *
 * All GLOBAL-only. None of these means anything per provider — a withdrawal is
 * a movement out of a balance, and by that point the points have no provider
 * attached to them. A key settable at a scope where it is meaningless makes the
 * resolution chain silently return a value nobody intended.
 */

/**
 * The smallest withdrawal.
 *
 * A floor exists because manual review costs an admin the same few minutes
 * whatever the amount, and a queue full of trivial requests is a queue that
 * stops being read. Set from what review actually costs, not guessed here.
 */
export const PAYOUTS_MINIMUM_POINTS: ConfigurationKeyDefinition<number> = {
  key: 'payouts.minimum_points',
  schema: z.number().int().min(1).max(10_000_000),
  defaultValue: 1000,
  description: 'Smallest withdrawal a user may request, in points',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * The largest single withdrawal.
 *
 * A ceiling is a fraud control, not an accounting one: it bounds what a single
 * compromised or fraudulent account can extract before a human looks twice, and
 * it costs a legitimate user only a second request.
 */
export const PAYOUTS_MAXIMUM_POINTS: ConfigurationKeyDefinition<number> = {
  key: 'payouts.maximum_points',
  schema: z.number().int().min(1).max(100_000_000),
  defaultValue: 500_000,
  description: 'Largest withdrawal a user may request in one go, in points',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * How many requests one account may submit per day.
 *
 * Bounds the review queue against a single account flooding it, which is
 * cheaper for the attacker than for us — every request costs them one HTTP
 * call and costs an admin a decision.
 */
export const PAYOUTS_MAX_REQUESTS_PER_DAY: ConfigurationKeyDefinition<number> = {
  key: 'payouts.max_requests_per_day',
  schema: z.number().int().min(1).max(100),
  defaultValue: 3,
  description: 'Withdrawal requests one account may submit in a rolling 24 hours',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * The payment methods a user may choose.
 *
 * **Configuration, not an enum in code** (PROJECT.md §4.6). Adding a method an
 * admin can settle by hand is one edit on the configuration screen: the method
 * is a label the admin reads next to a destination they also read, and the
 * money moves outside this system entirely.
 *
 * Constrained to a slug shape so a method code is safe to store, compare and
 * put in a URL — the validation a free-form list would otherwise lack.
 */
export const PAYOUTS_ENABLED_METHODS: ConfigurationKeyDefinition<string[]> = {
  key: 'payouts.enabled_methods',
  schema: z
    .array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'must be a lowercase slug'))
    .min(1, 'at least one payout method must be enabled')
    .max(32),
  defaultValue: ['paypal'],
  description:
    'Payment methods a user may request a withdrawal through; each is settled manually by an admin',
  scopes: ['GLOBAL'],
  valueType: 'json',
};

/**
 * How many points one unit of the payout currency is worth.
 *
 * The economics of the platform in one number, and the reason a user can be
 * told what their points are worth before they ask for them. Stored on each
 * request at submission time, so a later change never restates the value of a
 * withdrawal already in the queue (DECISIONS.md D42).
 */
export const PAYOUTS_POINTS_PER_CURRENCY_UNIT: ConfigurationKeyDefinition<number> = {
  key: 'payouts.points_per_currency_unit',
  schema: z.number().int().min(1).max(1_000_000),
  defaultValue: 1000,
  description:
    'Points equal to one unit of the payout currency, e.g. 1000 points = 1 USD',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

/**
 * The currency withdrawals are denominated in, ISO-4217.
 *
 * One currency, refused rather than converted if it disagrees with anything
 * else — the same stance the catalog takes on provider payouts. Multi-currency
 * needs a rate source and a display layer, and is an explicit extension point.
 */
export const PAYOUTS_CURRENCY: ConfigurationKeyDefinition<string> = {
  key: 'payouts.currency',
  schema: z.string().length(3).regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code'),
  defaultValue: 'USD',
  description: 'Currency withdrawals are denominated in',
  scopes: ['GLOBAL'],
  valueType: 'string',
};

export const PAYOUTS_CONFIGURATION_KEYS: readonly ConfigurationKeyDefinition[] = [
  PAYOUTS_MINIMUM_POINTS,
  PAYOUTS_MAXIMUM_POINTS,
  PAYOUTS_MAX_REQUESTS_PER_DAY,
  PAYOUTS_ENABLED_METHODS,
  PAYOUTS_POINTS_PER_CURRENCY_UNIT,
  PAYOUTS_CURRENCY,
] as const;
