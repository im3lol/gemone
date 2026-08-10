import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `offers` module — P3.
 *
 * PROJECT.md §1's P3 list names "reward rates (points per unit of provider
 * revenue)" and "currencies" explicitly. These are those values. They are the
 * economics of the platform, they change from live data within days of launch
 * (PROJECT.md §8), and every one of them is settable per provider — because
 * networks differ in payout reliability and a single rate across all of them
 * is either leaving money on the table or losing it.
 */

/**
 * Points a user earns per minor unit of provider payout, before revenue share.
 *
 * Integer, deliberately. Together with the share below, every points
 * calculation is integer arithmetic end to end — no float ever touches money
 * (DATABASE.md §5). A fractional "rate" would reintroduce exactly the
 * `2.45 * 100 = 244.99999999999997` class of bug the adapter layer already
 * avoids.
 */
/**
 * **This value and `payouts.points_per_currency_unit` are not independent.**
 *
 * A user's cash is `revenue x share% x (this x 100 / points_per_currency_unit)`,
 * so the revenue share means what it says only when
 *
 *     payouts.points_per_currency_unit == 100 x offers.points_per_minor_unit
 *
 * The two shipped defaults were `1` and `1000`, which is off by a factor of ten:
 * a 70% share paid the user 7% of provider revenue, on every conversion,
 * silently. Ten keeps the identity with the payout rate of 1000 points per
 * currency unit, and leaves `payouts.minimum_points` meaning the same 1.00 it
 * always did. Changing either value alone re-opens the same gap.
 */
export const OFFERS_POINTS_PER_MINOR_UNIT: ConfigurationKeyDefinition<number> = {
  key: 'offers.points_per_minor_unit',
  schema: z.number().int().min(1).max(10_000),
  defaultValue: 10,
  description:
    'Points awarded per minor unit of provider payout, before revenue share (10 = ten points per cent, matching 1000 points per currency unit)',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * The share of provider revenue passed on to the user, as a percentage.
 *
 * The platform's margin is the remainder. Separated from the rate above rather
 * than folded into one number so that an admin can change the *margin* without
 * recomputing what a point is worth — two different decisions, made by
 * different people, at different times.
 */
export const OFFERS_REWARD_SHARE_PERCENT: ConfigurationKeyDefinition<number> = {
  key: 'offers.reward_share_percent',
  schema: z.number().int().min(1).max(100),
  defaultValue: 70,
  description: 'Percentage of provider payout passed on to the user as points',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * The only currency the catalog accepts, ISO-4217.
 *
 * An offer quoted in anything else is **rejected**, not converted. Applying a
 * rate calibrated for one currency to another is silently wrong by whatever
 * the exchange rate happens to be, and the error is invisible: the offer looks
 * fine, it just pays the wrong amount forever.
 *
 * Multi-currency is an explicit extension point (ARCHITECTURE.md §21) that
 * needs conversion at credit time and a display layer. Until it exists,
 * refusing is the honest behaviour — and the rejection is counted on the sync
 * run, so an admin can see exactly how much catalog it costs.
 */
export const OFFERS_ACCOUNTING_CURRENCY: ConfigurationKeyDefinition<string> = {
  key: 'offers.accounting_currency',
  schema: z.string().length(3).regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code'),
  defaultValue: 'USD',
  description: 'The only payout currency the catalog accepts; others are rejected',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'string',
};

/**
 * The guard on full-sync pruning.
 *
 * A full sync deactivates every offer it did not see. That is correct when the
 * provider genuinely returned their whole catalog, and catastrophic when they
 * returned an empty page because their API had a bad minute: the entire
 * catalog for that provider goes dark, and nothing brings it back until the
 * next successful run.
 *
 * So a full sync refuses to prune when what it fetched is below this
 * percentage of what is currently active. The run completes as PARTIAL with
 * the reason recorded — offers stay live, which is the safe direction to fail.
 */
export const OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT: ConfigurationKeyDefinition<number> = {
  key: 'offers.sync.prune_safety_threshold_percent',
  schema: z.number().int().min(0).max(100),
  defaultValue: 50,
  description:
    'A full sync will not deactivate anything if it accepted fewer than this percentage of the currently active offers',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * How often a provider gets an authoritative (pruning) run.
 *
 * The provider row's `sync_interval_minutes` drives the frequent, non-pruning
 * runs. This is deliberately a separate, much longer cadence: pruning is the
 * expensive, risky half, and running it every few minutes multiplies the
 * chance of catching a provider mid-outage and deactivating a live catalog.
 */
export const OFFERS_FULL_SYNC_INTERVAL_HOURS: ConfigurationKeyDefinition<number> = {
  key: 'offers.sync.full_sync_interval_hours',
  schema: z.number().int().min(1).max(720),
  defaultValue: 24,
  description: 'Hours between authoritative full synchronizations that may deactivate offers',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * Registered as a list, so adding a key is one edit rather than two.
 *
 * Typed as the unparameterised definition because the keys are a mix of number
 * and string. Left inferred, TypeScript resolves the array to a union and then
 * cannot pick one `T` for `register<T>()` — the registry stores definitions
 * heterogeneously and is only generic to type each key at its *call* site,
 * which is where the type actually helps.
 */
export const OFFERS_CONFIGURATION_KEYS: readonly ConfigurationKeyDefinition[] = [
  OFFERS_POINTS_PER_MINOR_UNIT,
  OFFERS_REWARD_SHARE_PERCENT,
  OFFERS_ACCOUNTING_CURRENCY,
  OFFERS_PRUNE_SAFETY_THRESHOLD_PERCENT,
  OFFERS_FULL_SYNC_INTERVAL_HOURS,
] as const;
