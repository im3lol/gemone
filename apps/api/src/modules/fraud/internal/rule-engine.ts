import {
  FRAUD_ACTIONS,
  FRAUD_ACTION_SEVERITY,
  FRAUD_RULES,
  type FraudAction,
  type FraudEvaluationResult,
  type FraudRuleId,
  type FraudRuleSnapshot,
  type TriggeredRule,
} from '@gemone/contracts';

import type { FraudRuleSetting } from '../fraud.config';
import type { FraudEvaluationContext } from '../contracts/fraud-context';

/**
 * The rule engine — pure, and deliberately so.
 *
 * ARCHITECTURE.md §18.4 puts this in the "expensive to test anywhere else"
 * column: *"Pure logic over an input object (§4.2). Every rule and threshold
 * combination is cheap to test here and expensive to test anywhere else."*
 *
 * No class, no injection, no clock, no database. Everything it decides is a
 * function of its two arguments, which is what makes a held conversion from
 * last month explainable — feed the stored context and the stored snapshot back
 * in and the same answer comes out.
 */

/** A rule's settings plus the extra numbers some of them need. */
export interface RuleSettings {
  rules: Readonly<Record<FraudRuleId, FraudRuleSetting>>;
  chargebackMinimumConversions: number;
  disposableEmailDomains: readonly string[];
  /** When false, every rule is skipped and the evaluation records why. */
  enabled: boolean;
}

/** What one rule decided, before configuration is applied to it. */
type RuleOutcome =
  | { kind: 'fired'; observed: number; detail: string }
  | { kind: 'quiet'; observed: number }
  | { kind: 'skipped'; reason: string };

const quiet = (observed: number): RuleOutcome => ({ kind: 'quiet', observed });
const skip = (reason: string): RuleOutcome => ({ kind: 'skipped', reason });

/**
 * One rule: a name, and a function from context to outcome.
 *
 * Data rather than a switch, for the same reason the payout transitions are a
 * table — the set of rules is a business fact, and a business fact is easier to
 * audit as a list than as control flow.
 */
interface Rule {
  id: FraudRuleId;
  evaluate: (
    context: FraudEvaluationContext,
    setting: FraudRuleSetting,
    settings: RuleSettings,
  ) => RuleOutcome;
}

const RULES: readonly Rule[] = [
  {
    id: FRAUD_RULES.USER_CONVERSION_VELOCITY,
    evaluate: (context, setting) =>
      context.userConversionsInWindow > setting.threshold
        ? {
            kind: 'fired',
            observed: context.userConversionsInWindow,
            detail: `${context.userConversionsInWindow} conversions in the velocity window, above ${setting.threshold}`,
          }
        : quiet(context.userConversionsInWindow),
  },

  {
    id: FRAUD_RULES.IP_CONVERSION_VELOCITY,
    evaluate: (context, setting) => {
      if (context.ipConversionsInWindow === null) {
        return skip('the click carries no IP address');
      }

      return context.ipConversionsInWindow > setting.threshold
        ? {
            kind: 'fired',
            observed: context.ipConversionsInWindow,
            detail: `${context.ipConversionsInWindow} conversions from this IP in the velocity window, above ${setting.threshold}`,
          }
        : quiet(context.ipConversionsInWindow);
    },
  },

  {
    id: FRAUD_RULES.SHARED_IP_ACCOUNTS,
    evaluate: (context, setting) => {
      if (context.accountsSharingIp === null) {
        return skip('the click carries no IP address');
      }

      return context.accountsSharingIp > setting.threshold
        ? {
            kind: 'fired',
            observed: context.accountsSharingIp,
            detail: `${context.accountsSharingIp} accounts seen from this IP, above ${setting.threshold}`,
          }
        : quiet(context.accountsSharingIp);
    },
  },

  {
    id: FRAUD_RULES.SHARED_DEVICE_ACCOUNTS,
    evaluate: (context, setting) => {
      if (context.accountsSharingDevice === null) {
        return skip('the click carries no device fingerprint');
      }

      return context.accountsSharingDevice > setting.threshold
        ? {
            kind: 'fired',
            observed: context.accountsSharingDevice,
            detail: `${context.accountsSharingDevice} accounts share this device fingerprint, above ${setting.threshold}`,
          }
        : quiet(context.accountsSharingDevice);
    },
  },

  {
    id: FRAUD_RULES.IMPOSSIBLE_TIMING,
    evaluate: (context, setting) => {
      const elapsedSeconds = (context.conversionAt.getTime() - context.clickAt.getTime()) / 1000;

      if (elapsedSeconds < 0) {
        /*
         * A conversion timestamped before its own click.
         *
         * Not a timing signal — a broken one. The provider's clock is the
         * source of `conversionAt` and clock skew across networks is ordinary,
         * so scoring this as "impossibly fast" would fire hardest on whichever
         * provider's clock runs slowest. Recorded as unevaluable instead.
         */
        return skip('the conversion is timestamped before its click');
      }

      return elapsedSeconds < setting.threshold
        ? {
            kind: 'fired',
            observed: Math.floor(elapsedSeconds),
            detail: `converted ${Math.floor(elapsedSeconds)}s after the click, under ${setting.threshold}s`,
          }
        : quiet(Math.floor(elapsedSeconds));
    },
  },

  {
    id: FRAUD_RULES.CHARGEBACK_RATE,
    evaluate: (context, setting, settings) => {
      if (context.lifetimeConversions < settings.chargebackMinimumConversions) {
        /*
         * One conversion, reversed, is a 100% chargeback rate and no evidence
         * of anything. Without this floor the rule fires hardest on the
         * accounts it knows least about.
         */
        return skip(
          `only ${context.lifetimeConversions} conversions, below the ${settings.chargebackMinimumConversions} needed to judge a rate`,
        );
      }

      const rate = Math.round((context.lifetimeChargebacks / context.lifetimeConversions) * 100);

      return rate > setting.threshold
        ? {
            kind: 'fired',
            observed: rate,
            detail: `${rate}% of ${context.lifetimeConversions} conversions were reversed, above ${setting.threshold}%`,
          }
        : quiet(rate);
    },
  },

  {
    id: FRAUD_RULES.DISPOSABLE_EMAIL,
    evaluate: (context, _setting, settings) => {
      if (context.emailDomain === null) {
        return skip('the account has no email domain on record');
      }

      if (settings.disposableEmailDomains.length === 0) {
        // An empty blocklist is a rule nobody has configured yet, not a rule
        // that looked and found nothing.
        return skip('the disposable-domain blocklist is empty');
      }

      return settings.disposableEmailDomains.includes(context.emailDomain)
        ? {
            kind: 'fired',
            observed: 1,
            detail: `${context.emailDomain} is on the disposable-domain blocklist`,
          }
        : quiet(0);
    },
  },
];

/**
 * Score a conversion.
 *
 * Returns the recommendation and the evidence; applying it is the caller's job
 * and always goes through `RewardAccountingService` (P2). Nothing in this file
 * can move a point.
 */
export function evaluateRules(
  context: FraudEvaluationContext,
  settings: RuleSettings,
): FraudEvaluationResult {
  const triggered: TriggeredRule[] = [];
  const skipped: { rule: FraudRuleId; reason: string }[] = [];
  const snapshot: FraudRuleSnapshot[] = [];

  for (const rule of RULES) {
    const setting = settings.rules[rule.id];

    snapshot.push({
      rule: rule.id,
      enabled: setting.enabled && settings.enabled,
      threshold: setting.threshold,
      weight: setting.weight,
      action: setting.action,
    });

    if (!settings.enabled) {
      skipped.push({ rule: rule.id, reason: 'fraud scoring is disabled globally' });
      continue;
    }

    if (!setting.enabled) {
      skipped.push({ rule: rule.id, reason: 'the rule is disabled' });
      continue;
    }

    const outcome = rule.evaluate(context, setting, settings);

    if (outcome.kind === 'skipped') {
      skipped.push({ rule: rule.id, reason: outcome.reason });
      continue;
    }

    if (outcome.kind === 'fired') {
      triggered.push({
        rule: rule.id,
        observed: outcome.observed,
        threshold: setting.threshold,
        weight: setting.weight,
        action: setting.action,
        detail: outcome.detail,
      });
    }
  }

  return {
    score: triggered.reduce((total, rule) => total + rule.weight, 0),
    action: combineActions(triggered),
    triggered,
    snapshot,
    skipped,
  };
}

/**
 * The most severe action any triggered rule asks for.
 *
 * **Severity, not score.** A score threshold would be a second mechanism
 * deciding the same thing as the per-rule actions P3 requires, and the two
 * would disagree the first time somebody tuned one of them. One rule
 * configured to `BLOCK` means block, whatever the arithmetic says.
 */
export function combineActions(triggered: readonly TriggeredRule[]): FraudAction {
  return triggered.reduce<FraudAction>(
    (worst, rule) =>
      FRAUD_ACTION_SEVERITY[rule.action] > FRAUD_ACTION_SEVERITY[worst] ? rule.action : worst,
    FRAUD_ACTIONS.ALLOW,
  );
}

/** Exposed for the tests that assert the rule set is complete. */
export const __testing = { RULES };
