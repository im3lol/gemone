import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `providers` module — P3.
 *
 * The first business keys in the codebase. `core/config` deliberately shipped
 * with none: keys arrive with the feature that owns the rule, so that a key
 * and the code reading it land together (ARCHITECTURE.md §4.9).
 *
 * Why these are configuration and not constants, by §5.1's test — *would a
 * non-developer reasonably need to change this, and does changing it alter
 * user-visible behaviour?* Yes to both. A provider having a bad hour is an
 * operational judgement call, it is made at 2 a.m., and a provider marked
 * DOWN is one an operator will disable, which removes its offers from the
 * wall. That is user-visible economics decided by a threshold — exactly what
 * P3 forbids hardcoding.
 *
 * Both are settable per provider, because tolerance is not uniform: a network
 * with a flaky API that still pays reliably deserves more patience than one
 * whose failures have historically meant lost conversions.
 */

export const PROVIDER_HEALTH_DEGRADED_AFTER: ConfigurationKeyDefinition<number> = {
  key: 'providers.health.degraded_after_failures',
  schema: z.number().int().min(1).max(1000),
  defaultValue: 3,
  description:
    'Consecutive failed provider operations before the provider is marked DEGRADED',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

export const PROVIDER_HEALTH_DOWN_AFTER: ConfigurationKeyDefinition<number> = {
  key: 'providers.health.down_after_failures',
  schema: z.number().int().min(1).max(1000),
  defaultValue: 10,
  description:
    'Consecutive failed provider operations before the provider is marked DOWN',
  scopes: ['GLOBAL', 'PROVIDER'],
  valueType: 'number',
};

/**
 * Registered as a list so adding a key is one edit, not two.
 *
 * Note what is NOT here: the sync interval and the postback IP ranges. Both
 * are columns on the provider row (DATABASE.md §3.2) — the row is the single
 * place a provider's identity and operational state live, and splitting half
 * of it into configuration would mean two sources of truth for one provider.
 */
export const PROVIDER_CONFIGURATION_KEYS = [
  PROVIDER_HEALTH_DEGRADED_AFTER,
  PROVIDER_HEALTH_DOWN_AFTER,
] as const;
