import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `rewards` module — P3.
 *
 * The hold period is a business rule in the purest sense: it trades user
 * patience against our exposure to chargebacks, a non-developer decides it, and
 * changing it changes what users experience. ARCHITECTURE.md §5.1's test
 * classifies it as configuration explicitly.
 */

/**
 * Days a credit stays in `pending` before becoming withdrawable.
 *
 * Per provider, because the risk it prices is per provider: a network that
 * charges back three weeks later needs a longer hold than one that confirms
 * within hours. A single global hold is either paying out before chargebacks
 * arrive, or making every user wait for the worst network.
 *
 * Zero is permitted and means "available immediately" — the honest way to
 * express a provider we trust, rather than a special case in code.
 *
 * The value resolved here is **stored on the reward transaction** and never
 * re-read (ARCHITECTURE.md §9.4), so changing it applies to new credits only.
 */
export const REWARDS_HOLD_PERIOD_DAYS: ConfigurationKeyDefinition<number> = {
  key: 'rewards.hold_period_days',
  schema: z.number().int().min(0).max(180),
  defaultValue: 14,
  description:
    'Days a conversion credit stays pending before it becomes withdrawable; resolved at credit time and stored on the transaction',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * How many credits one maturation run may process.
 *
 * Operational, not economic — it bounds a job's transaction count, it does not
 * change what anyone is paid, so §5.1 puts it here as a constant rather than as
 * a configuration key. An unbounded job over a growing table works in month one
 * and takes the worker down in month six (§12.2, rule 2).
 */
export const MATURATION_BATCH_SIZE = 500;

/**
 * How many balances one reconciliation page checks before re-enqueueing.
 *
 * A constant rather than a configuration key, on DATABASE.md §3.2's line: this
 * is operational cadence, not economics. Getting it wrong changes how the sweep
 * is chopped up, not what anybody is paid, and P3 is about business rules.
 *
 * Smaller than the maturation batch because each unit here is an aggregate over
 * one user's history rather than a single-row update (TODO T28).
 */
export const RECONCILIATION_BATCH_SIZE = 200;

export const REWARDS_CONFIGURATION_KEYS: readonly ConfigurationKeyDefinition[] = [
  REWARDS_HOLD_PERIOD_DAYS,
] as const;
