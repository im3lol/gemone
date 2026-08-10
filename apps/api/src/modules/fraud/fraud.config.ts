import { FRAUD_ACTIONS, FRAUD_RULES, type FraudRuleId } from '@gemone/contracts';
import { z } from 'zod';

import type { ConfigurationKeyDefinition } from '../../core/config/configuration-key';

/**
 * Configuration keys owned by the `fraud` module — P3.
 *
 * PROJECT.md §4.7 is unusually specific here: *"every rule's threshold **and**
 * its resulting action (score-only, hold, require-review, block) is
 * configuration. Rules can be enabled, disabled, and retuned from the admin
 * panel without a deployment — which matters because fraud patterns change
 * faster than release cycles."*
 *
 * ## Why one JSON key per rule rather than four keys per rule
 *
 * A rule's enabled flag, threshold, weight and action are one decision, and
 * splitting them across four keys makes it possible to save half of it. An
 * admin raising a threshold and softening the action would otherwise have a
 * window — however brief — where the new threshold runs with the old action.
 * One key, one write, validated as a whole (D48).
 *
 * ## Why the values here are shaped as starting points, not answers
 *
 * ARCHITECTURE.md §23 open question 5: *"Fraud rule set at launch. Their
 * thresholds and actions are configuration. The starting values should come
 * from the first two weeks of real conversion data, not from a guess made
 * now."* These defaults are deliberately cautious — every rule defaults to
 * `HOLD` at most, nothing defaults to `BLOCK`, and holding is the recoverable
 * direction.
 */

const ruleSettingSchema = z.object({
  enabled: z.boolean(),
  /**
   * The number the rule compares against. Its unit is the rule's own — a
   * count, a percentage, or a number of seconds — which is why it is
   * documented per key rather than constrained here.
   */
  threshold: z.number().min(0),
  /** Points added to the score when it fires. */
  weight: z.number().int().min(0).max(100),
  action: z.enum([
    FRAUD_ACTIONS.ALLOW,
    FRAUD_ACTIONS.HOLD,
    FRAUD_ACTIONS.REVIEW,
    FRAUD_ACTIONS.BLOCK,
  ]),
});

export type FraudRuleSetting = z.infer<typeof ruleSettingSchema>;

/**
 * Both scopes.
 *
 * Networks differ substantially in how much fraud they carry, and the
 * resolution chain already supports the override — the same reasoning that
 * gave the hold period a per-provider scope (PROJECT.md §4.7). A conversion
 * always has a provider, so the scope is never ambiguous at evaluation time.
 */
const RULE_SCOPES = ['GLOBAL', 'PROVIDER'] as const;

function ruleKey(
  rule: FraudRuleId,
  description: string,
  defaultValue: FraudRuleSetting,
): ConfigurationKeyDefinition<FraudRuleSetting> {
  return {
    key: `fraud.rules.${rule.toLowerCase()}`,
    schema: ruleSettingSchema,
    defaultValue,
    description,
    scopes: [...RULE_SCOPES],
    valueType: 'json',
  };
}

/**
 * The master switch.
 *
 * Seven per-rule `enabled` flags can turn everything off, but not in one
 * write. This exists for the incident where scoring itself is the problem —
 * a bad threshold rollout holding every conversion on the platform — and in
 * that moment the fix has to be one action, not seven.
 *
 * Disabling it does not skip evaluation silently: an evaluation is still
 * recorded, with every rule skipped, so the gap is visible afterwards rather
 * than looking like a period with no fraud.
 */
export const FRAUD_ENABLED: ConfigurationKeyDefinition<boolean> = {
  key: 'fraud.enabled',
  schema: z.boolean(),
  defaultValue: true,
  description: 'Master switch for fraud scoring; off records an empty evaluation',
  scopes: ['GLOBAL'],
  valueType: 'boolean',
};

/** The window the velocity rules count over. Shared, so the two cannot disagree. */
export const FRAUD_VELOCITY_WINDOW_MINUTES: ConfigurationKeyDefinition<number> = {
  key: 'fraud.velocity_window_minutes',
  schema: z.number().int().min(1).max(10_080),
  defaultValue: 60,
  description: 'Window, in minutes, that the conversion-velocity rules count over',
  scopes: [...RULE_SCOPES],
  valueType: 'number',
};

/** How far back the multi-accounting rules look for other accounts. */
export const FRAUD_SHARED_IDENTITY_WINDOW_DAYS: ConfigurationKeyDefinition<number> = {
  key: 'fraud.shared_identity_window_days',
  schema: z.number().int().min(1).max(365),
  defaultValue: 30,
  description: 'How many days back the shared-IP and shared-device rules look',
  scopes: [...RULE_SCOPES],
  valueType: 'number',
};

/**
 * The floor under the chargeback-rate rule.
 *
 * A user with one conversion that was reversed has a 100% chargeback rate and
 * has done nothing wrong. Without a floor this rule fires hardest on the
 * accounts it knows least about.
 */
export const FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS: ConfigurationKeyDefinition<number> = {
  key: 'fraud.chargeback_minimum_conversions',
  schema: z.number().int().min(1).max(1000),
  defaultValue: 5,
  description: 'Conversions a user needs before their chargeback rate is judged',
  scopes: [...RULE_SCOPES],
  valueType: 'number',
};

/**
 * The disposable-domain blocklist (PROJECT.md §4.7).
 *
 * Configuration rather than a bundled list: these domains appear and vanish
 * weekly, and a list in code is a deployment every time one does. Empty by
 * default — an inherited blocklist nobody chose would silently hold real users
 * on day one.
 */
export const FRAUD_DISPOSABLE_EMAIL_DOMAINS: ConfigurationKeyDefinition<string[]> = {
  key: 'fraud.disposable_email_domains',
  schema: z.array(z.string().min(1).max(253)).max(5000),
  defaultValue: [],
  description: 'Email domains treated as disposable, lowercase, without the @',
  scopes: ['GLOBAL'],
  valueType: 'json',
};

export const FRAUD_RULE_USER_CONVERSION_VELOCITY = ruleKey(
  FRAUD_RULES.USER_CONVERSION_VELOCITY,
  'Conversions by one user within the velocity window before the rule fires',
  { enabled: true, threshold: 10, weight: 25, action: FRAUD_ACTIONS.HOLD },
);

export const FRAUD_RULE_IP_CONVERSION_VELOCITY = ruleKey(
  FRAUD_RULES.IP_CONVERSION_VELOCITY,
  'Conversions from one IP within the velocity window before the rule fires',
  { enabled: true, threshold: 20, weight: 25, action: FRAUD_ACTIONS.HOLD },
);

export const FRAUD_RULE_SHARED_IP_ACCOUNTS = ruleKey(
  FRAUD_RULES.SHARED_IP_ACCOUNTS,
  'Distinct accounts sharing one IP before the rule fires',
  /*
   * Deliberately lenient. Shared IPs are ordinary — university networks,
   * offices, carrier-grade NAT on mobile — and a low threshold here scores
   * geography rather than fraud.
   */
  { enabled: true, threshold: 8, weight: 15, action: FRAUD_ACTIONS.HOLD },
);

export const FRAUD_RULE_SHARED_DEVICE_ACCOUNTS = ruleKey(
  FRAUD_RULES.SHARED_DEVICE_ACCOUNTS,
  'Distinct accounts sharing one device fingerprint before the rule fires',
  /*
   * Stricter than shared IP, and weighted higher: a shared IP is a shared
   * building, while a shared device fingerprint is closer to a shared person.
   * Still not conclusive — fingerprints collide, and the value is
   * client-supplied and therefore forgeable — which is why it holds rather
   * than blocks.
   */
  { enabled: true, threshold: 3, weight: 30, action: FRAUD_ACTIONS.REVIEW },
);

export const FRAUD_RULE_IMPOSSIBLE_TIMING = ruleKey(
  FRAUD_RULES.IMPOSSIBLE_TIMING,
  'Seconds between click and conversion below which the conversion is implausible',
  /*
   * Thirty seconds. Not "how long the offer takes" — that is per-offer and we
   * do not have it — but a floor below which no offer requiring a human action
   * could have been completed.
   */
  { enabled: true, threshold: 30, weight: 30, action: FRAUD_ACTIONS.HOLD },
);

export const FRAUD_RULE_CHARGEBACK_RATE = ruleKey(
  FRAUD_RULES.CHARGEBACK_RATE,
  'Percentage of a user’s conversions that were reversed before the rule fires',
  { enabled: true, threshold: 40, weight: 35, action: FRAUD_ACTIONS.REVIEW },
);

export const FRAUD_RULE_DISPOSABLE_EMAIL = ruleKey(
  FRAUD_RULES.DISPOSABLE_EMAIL,
  'Fires when the account’s email domain is on the blocklist; threshold unused',
  /*
   * A boolean rule wearing the same shape as the numeric ones. The threshold
   * is meaningless and fixed at 1, which is a small cost for one rule
   * evaluation path, one storage shape, and one admin screen (P6).
   */
  { enabled: true, threshold: 1, weight: 20, action: FRAUD_ACTIONS.HOLD },
);

/** Every rule's key definition, in the order the engine evaluates them. */
export const FRAUD_RULE_KEYS: Readonly<
  Record<FraudRuleId, ConfigurationKeyDefinition<FraudRuleSetting>>
> = {
  [FRAUD_RULES.USER_CONVERSION_VELOCITY]: FRAUD_RULE_USER_CONVERSION_VELOCITY,
  [FRAUD_RULES.IP_CONVERSION_VELOCITY]: FRAUD_RULE_IP_CONVERSION_VELOCITY,
  [FRAUD_RULES.SHARED_IP_ACCOUNTS]: FRAUD_RULE_SHARED_IP_ACCOUNTS,
  [FRAUD_RULES.SHARED_DEVICE_ACCOUNTS]: FRAUD_RULE_SHARED_DEVICE_ACCOUNTS,
  [FRAUD_RULES.IMPOSSIBLE_TIMING]: FRAUD_RULE_IMPOSSIBLE_TIMING,
  [FRAUD_RULES.CHARGEBACK_RATE]: FRAUD_RULE_CHARGEBACK_RATE,
  [FRAUD_RULES.DISPOSABLE_EMAIL]: FRAUD_RULE_DISPOSABLE_EMAIL,
};

export const FRAUD_CONFIGURATION_KEYS: ConfigurationKeyDefinition<unknown>[] = [
  FRAUD_ENABLED,
  FRAUD_VELOCITY_WINDOW_MINUTES,
  FRAUD_SHARED_IDENTITY_WINDOW_DAYS,
  FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS,
  FRAUD_DISPOSABLE_EMAIL_DOMAINS,
  ...Object.values(FRAUD_RULE_KEYS),
] as ConfigurationKeyDefinition<unknown>[];
