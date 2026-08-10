import {
  FRAUD_ACTIONS,
  FRAUD_RULES,
  type FraudAction,
  type FraudRuleId,
  type TriggeredRule,
} from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import type { FraudEvaluationContext } from '../contracts/fraud-context';
import {
  FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS,
  FRAUD_RULE_KEYS,
  type FraudRuleSetting,
} from '../fraud.config';
import { __testing, combineActions, evaluateRules, type RuleSettings } from './rule-engine';

/**
 * The rule engine — ARCHITECTURE.md §18.4.
 *
 * *"Pure logic over an input object (§4.2). Every rule and threshold
 * combination is cheap to test here and expensive to test anywhere else."*
 *
 * Not one line of this file constructs a database, a module, or a mock. That is
 * the entire payoff §4.2 bought by making the caller assemble the context, and
 * it is why these tests can afford to be exhaustive about the branch that
 * decides whether someone gets paid.
 */

const ALL_RULES = Object.values(FRAUD_RULES);

describe('the rule set', () => {
  it('implements every rule the contract declares, and no others', () => {
    /*
     * Exhaustive rather than by example. A rule id that exists in the contract
     * with no implementation is a rule an admin can configure, see in the
     * snapshot of every evaluation, and which silently never fires.
     */
    const implemented = __testing.RULES.map((rule) => rule.id).sort();

    expect(implemented).toEqual([...ALL_RULES].sort());
  });

  it('snapshots every rule on every evaluation, fired or not', () => {
    // DATABASE.md §3.6: the snapshot explains a hold months later. One that
    // recorded only the rules that fired could not answer "what did the rules
    // that stayed quiet have their thresholds set to?".
    const result = evaluateRules(context(), settings());

    expect(result.snapshot.map((rule) => rule.rule).sort()).toEqual([...ALL_RULES].sort());
  });
});

describe('user conversion velocity', () => {
  it('stays quiet at the threshold and fires above it', () => {
    /*
     * The boundary, asserted from both sides. A rule using `>=` where it means
     * `>` holds every user who hits exactly the configured number — which is
     * the number an admin picked as acceptable.
     */
    expect(fired(evaluate({ userConversionsInWindow: 10 }))).toEqual([]);
    expect(fired(evaluate({ userConversionsInWindow: 11 }))).toEqual([
      FRAUD_RULES.USER_CONVERSION_VELOCITY,
    ]);
  });

  it('records what it saw and what it compared against', () => {
    const rule = triggered(evaluate({ userConversionsInWindow: 25 }))[0];

    // Both numbers, because neither answers "which rule held this, at what
    // threshold?" alone (DATABASE.md §3.6).
    expect(rule).toMatchObject({ observed: 25, threshold: 10 });
    expect(rule?.detail).toContain('25');
  });
});

describe('IP-based rules', () => {
  it('skips rather than scores when the click carries no IP', () => {
    /*
     * The distinction the `skipped` list exists for. "No rule fired" and "the
     * rule never ran" are different facts, and treating a missing IP as zero
     * conversions would report the second as the first — reassuring, and
     * wrong.
     */
    const result = evaluate({
      clickIp: null,
      ipConversionsInWindow: null,
      accountsSharingIp: null,
    });

    const skippedRules = result.skipped.map((entry) => entry.rule);

    expect(skippedRules).toContain(FRAUD_RULES.IP_CONVERSION_VELOCITY);
    expect(skippedRules).toContain(FRAUD_RULES.SHARED_IP_ACCOUNTS);
    expect(fired(result)).toEqual([]);
  });

  it('fires on conversion velocity from one address', () => {
    expect(fired(evaluate({ ipConversionsInWindow: 21 }))).toEqual([
      FRAUD_RULES.IP_CONVERSION_VELOCITY,
    ]);
  });

  it('fires on too many accounts behind one address', () => {
    expect(fired(evaluate({ accountsSharingIp: 9 }))).toEqual([FRAUD_RULES.SHARED_IP_ACCOUNTS]);
  });

  it('tolerates the ordinary shared address', () => {
    // Offices, universities and carrier-grade NAT. A threshold low enough to
    // catch two flatmates scores geography, not fraud.
    expect(fired(evaluate({ accountsSharingIp: 8 }))).toEqual([]);
  });
});

describe('shared device fingerprint', () => {
  it('fires above the threshold', () => {
    expect(fired(evaluate({ accountsSharingDevice: 4 }))).toEqual([
      FRAUD_RULES.SHARED_DEVICE_ACCOUNTS,
    ]);
  });

  it('skips when the click carries no fingerprint', () => {
    const result = evaluate({ clickDeviceFingerprint: null, accountsSharingDevice: null });

    expect(result.skipped.map((entry) => entry.rule)).toContain(
      FRAUD_RULES.SHARED_DEVICE_ACCOUNTS,
    );
  });

  it('asks for review rather than merely holding', () => {
    /*
     * A shared IP is a shared building; a shared fingerprint is closer to a
     * shared person. The default action differs for that reason, and the
     * difference is what the review screen shows an admin.
     */
    expect(triggered(evaluate({ accountsSharingDevice: 4 }))[0]?.action).toBe(
      FRAUD_ACTIONS.REVIEW,
    );
  });

  it('never blocks on a value the client supplied', () => {
    /*
     * The fingerprint is computed by the browser and therefore forgeable
     * (DATABASE.md §3.3). A rule that blocked on it would hand any attacker a
     * way to get *other people's* conversions refused by copying their
     * fingerprint — the signal is only safe because being wrong costs a delay.
     */
    const setting = settings().rules[FRAUD_RULES.SHARED_DEVICE_ACCOUNTS];

    expect(setting.action).not.toBe(FRAUD_ACTIONS.BLOCK);
  });
});

describe('impossible timing', () => {
  const clickAt = new Date('2026-01-01T10:00:00.000Z');

  it('fires when the conversion beats the floor', () => {
    const result = evaluate({
      clickAt,
      conversionAt: new Date(clickAt.getTime() + 5_000),
    });

    expect(fired(result)).toEqual([FRAUD_RULES.IMPOSSIBLE_TIMING]);
    expect(triggered(result)[0]?.observed).toBe(5);
  });

  it('stays quiet at exactly the floor', () => {
    expect(
      fired(evaluate({ clickAt, conversionAt: new Date(clickAt.getTime() + 30_000) })),
    ).toEqual([]);
  });

  it('skips a conversion timestamped before its own click', () => {
    /*
     * **Clock skew, not fraud.** `conversionAt` comes from the provider, and
     * networks' clocks disagree. Scoring a negative elapsed time as
     * "impossibly fast" would fire hardest on whichever provider's clock runs
     * slowest, holding that network's users for a reason that is ours.
     */
    const result = evaluate({
      clickAt,
      conversionAt: new Date(clickAt.getTime() - 60_000),
    });

    expect(fired(result)).toEqual([]);
    expect(result.skipped.map((entry) => entry.rule)).toContain(FRAUD_RULES.IMPOSSIBLE_TIMING);
  });
});

describe('chargeback rate', () => {
  it('refuses to judge an account with too little history', () => {
    /*
     * One conversion, reversed, is a 100% chargeback rate and no evidence of
     * anything. Without the floor this rule fires hardest on the accounts it
     * knows least about — which is every new user who hits one bad offer.
     */
    const result = evaluate({ lifetimeConversions: 1, lifetimeChargebacks: 1 });

    expect(fired(result)).toEqual([]);
    expect(
      result.skipped.find((entry) => entry.rule === FRAUD_RULES.CHARGEBACK_RATE)?.reason,
    ).toContain('below');
  });

  it('fires once there is enough history and the rate is high', () => {
    const result = evaluate({ lifetimeConversions: 10, lifetimeChargebacks: 5 });

    expect(fired(result)).toEqual([FRAUD_RULES.CHARGEBACK_RATE]);
    expect(triggered(result)[0]?.observed).toBe(50);
  });

  it('stays quiet on a rate at the threshold', () => {
    expect(fired(evaluate({ lifetimeConversions: 10, lifetimeChargebacks: 4 }))).toEqual([]);
  });
});

describe('disposable email', () => {
  it('fires on a listed domain', () => {
    const result = evaluateRules(
      context({ emailDomain: 'mailinator.com' }),
      settings({ disposableEmailDomains: ['mailinator.com'] }),
    );

    expect(fired(result)).toEqual([FRAUD_RULES.DISPOSABLE_EMAIL]);
  });

  it('skips when the blocklist is empty rather than reporting a clean check', () => {
    // An unconfigured rule has not cleared anybody. Recording it as quiet
    // would make an empty blocklist look like a blocklist that found nothing.
    const result = evaluateRules(context({ emailDomain: 'mailinator.com' }), settings());

    expect(
      result.skipped.find((entry) => entry.rule === FRAUD_RULES.DISPOSABLE_EMAIL)?.reason,
    ).toContain('empty');
  });

  it('skips when the account has no email domain on record', () => {
    const result = evaluateRules(
      context({ emailDomain: null }),
      settings({ disposableEmailDomains: ['mailinator.com'] }),
    );

    expect(result.skipped.map((entry) => entry.rule)).toContain(FRAUD_RULES.DISPOSABLE_EMAIL);
  });
});

describe('scoring and the combined action', () => {
  it('sums the weights of the rules that fired, and only those', () => {
    const result = evaluate({ userConversionsInWindow: 50, accountsSharingIp: 20 });

    // 25 + 15, from the two rules' configured weights.
    expect(result.score).toBe(40);
  });

  it('scores zero when nothing fires', () => {
    expect(evaluate({}).score).toBe(0);
    expect(evaluate({}).action).toBe(FRAUD_ACTIONS.ALLOW);
  });

  it('takes the most severe action, not the most common one', () => {
    /*
     * **Severity, not arithmetic.** Three rules asking to hold do not add up
     * to a block, and one rule an admin configured to block is not outvoted by
     * two that only wanted a hold. A score threshold would be a second
     * mechanism deciding the same thing as the per-rule actions P3 requires,
     * and the two would disagree the first time either was tuned.
     */
    expect(
      combineActions([
        rule(FRAUD_ACTIONS.HOLD),
        rule(FRAUD_ACTIONS.HOLD),
        rule(FRAUD_ACTIONS.HOLD),
      ]),
    ).toBe(FRAUD_ACTIONS.HOLD);

    expect(combineActions([rule(FRAUD_ACTIONS.HOLD), rule(FRAUD_ACTIONS.BLOCK)])).toBe(
      FRAUD_ACTIONS.BLOCK,
    );
  });

  it.each([
    [[FRAUD_ACTIONS.ALLOW], FRAUD_ACTIONS.ALLOW],
    [[FRAUD_ACTIONS.ALLOW, FRAUD_ACTIONS.HOLD], FRAUD_ACTIONS.HOLD],
    [[FRAUD_ACTIONS.HOLD, FRAUD_ACTIONS.REVIEW], FRAUD_ACTIONS.REVIEW],
    [[FRAUD_ACTIONS.REVIEW, FRAUD_ACTIONS.BLOCK], FRAUD_ACTIONS.BLOCK],
    [[FRAUD_ACTIONS.BLOCK, FRAUD_ACTIONS.ALLOW], FRAUD_ACTIONS.BLOCK],
  ])('combines %s into %s', (actions, expected) => {
    expect(combineActions(actions.map((action) => rule(action as FraudAction)))).toBe(expected);
  });

  it('allows when nothing has fired, whatever the rules are set to', () => {
    expect(combineActions([])).toBe(FRAUD_ACTIONS.ALLOW);
  });

  it('never defaults any shipped rule to BLOCK', () => {
    /*
     * PROJECT.md §4.7: *"Rejecting legitimate users is more expensive than a
     * short hold."* `BLOCK` exists so an admin can configure a rule up to it
     * once a signal has proven conclusive — not so a default can refuse
     * somebody's conversion on day one, before anybody has seen what this
     * platform's fraud actually looks like (§23, open question 5).
     */
    const shipped = Object.values(settings().rules).map((setting) => setting.action);

    expect(shipped).not.toContain(FRAUD_ACTIONS.BLOCK);
  });
});

describe('the master switch and per-rule disabling', () => {
  it('records every rule as skipped when scoring is off, rather than allowing silently', () => {
    /*
     * The difference between "we looked and found nothing" and "we were not
     * looking". A window with scoring disabled must be visible afterwards as
     * exactly that, or it reads as a quiet period with no fraud.
     */
    const result = evaluateRules(
      context({ userConversionsInWindow: 500, accountsSharingDevice: 50 }),
      settings({ enabled: false }),
    );

    expect(result.skipped).toHaveLength(ALL_RULES.length);
    expect(result.triggered).toEqual([]);
    expect(result.action).toBe(FRAUD_ACTIONS.ALLOW);
    expect(result.snapshot.every((rule) => !rule.enabled)).toBe(true);
  });

  it('skips a single disabled rule and keeps evaluating the rest', () => {
    const base = settings();
    const result = evaluateRules(
      context({ userConversionsInWindow: 50, accountsSharingIp: 20 }),
      {
        ...base,
        rules: {
          ...base.rules,
          [FRAUD_RULES.USER_CONVERSION_VELOCITY]: {
            ...base.rules[FRAUD_RULES.USER_CONVERSION_VELOCITY],
            enabled: false,
          },
        },
      },
    );

    expect(fired(result)).toEqual([FRAUD_RULES.SHARED_IP_ACCOUNTS]);
    expect(result.skipped.map((entry) => entry.rule)).toContain(
      FRAUD_RULES.USER_CONVERSION_VELOCITY,
    );
  });

  it('honours a threshold an admin retuned, without a deployment', () => {
    /*
     * P3, and the reason §4.7 insists on it: *"fraud patterns change faster
     * than release cycles."* The same context scores differently under
     * different configuration, which is the entire point.
     */
    const base = settings();
    const tightened = {
      ...base,
      rules: {
        ...base.rules,
        [FRAUD_RULES.USER_CONVERSION_VELOCITY]: {
          ...base.rules[FRAUD_RULES.USER_CONVERSION_VELOCITY],
          threshold: 2,
        },
      },
    };

    expect(fired(evaluateRules(context({ userConversionsInWindow: 5 }), base))).toEqual([]);
    expect(fired(evaluateRules(context({ userConversionsInWindow: 5 }), tightened))).toEqual([
      FRAUD_RULES.USER_CONVERSION_VELOCITY,
    ]);
  });
});

describe('purity', () => {
  it('returns the same answer for the same input, every time', () => {
    /*
     * The property that makes a stored evaluation replayable (§4.2): feed the
     * context and the snapshot back in and the same decision comes out. A rule
     * reading the clock or a counter would break this without breaking
     * anything else visible.
     */
    const input = context({ userConversionsInWindow: 40, accountsSharingDevice: 6 });
    const config = settings();

    expect(evaluateRules(input, config)).toEqual(evaluateRules(input, config));
  });

  it('does not mutate the context it was given', () => {
    const input = context({ userConversionsInWindow: 40 });
    const snapshot = structuredClone(input);

    evaluateRules(input, settings());

    expect(input).toEqual(snapshot);
  });
});

// --- Fixtures ---------------------------------------------------------------

/** A clean account that fires nothing. Every test starts here and moves one number. */
function context(overrides: Partial<FraudEvaluationContext> = {}): FraudEvaluationContext {
  return {
    userId: 'user-1',
    providerId: 'provider-1',
    emailDomain: 'example.com',
    accountCreatedAt: new Date('2025-01-01T00:00:00.000Z'),

    clickAt: new Date('2026-01-01T10:00:00.000Z'),
    clickIp: '203.0.113.10',
    clickDeviceFingerprint: 'fp-1',

    conversionAt: new Date('2026-01-01T11:00:00.000Z'),

    userConversionsInWindow: 0,
    ipConversionsInWindow: 0,
    accountsSharingIp: 0,
    accountsSharingDevice: 0,
    lifetimeConversions: 0,
    lifetimeChargebacks: 0,
    ...overrides,
  };
}

/** The shipped defaults, so the tests assert what production actually does. */
function settings(overrides: Partial<RuleSettings> = {}): RuleSettings {
  const rules = Object.fromEntries(
    ALL_RULES.map((rule) => [rule, defaultSettingFor(rule)]),
  ) as Record<FraudRuleId, FraudRuleSetting>;

  return {
    enabled: true,
    rules,
    chargebackMinimumConversions: FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS.defaultValue,
    disposableEmailDomains: [],
    ...overrides,
  };
}

/**
 * Read from the module's own key definitions, never re-typed here.
 *
 * A hand-copied table would let a default change in `fraud.config.ts` without
 * a single test noticing — and these tests claim to assert what production
 * actually does. It is the "never blocks by default" assertion that makes this
 * matter most: copied, it would keep passing after somebody set a rule to
 * BLOCK.
 */
function defaultSettingFor(rule: FraudRuleId): FraudRuleSetting {
  return FRAUD_RULE_KEYS[rule].defaultValue;
}

function evaluate(overrides: Partial<FraudEvaluationContext>) {
  return evaluateRules(context(overrides), settings());
}

function fired(result: { triggered: TriggeredRule[] }): FraudRuleId[] {
  return result.triggered.map((entry) => entry.rule);
}

function triggered(result: { triggered: TriggeredRule[] }): TriggeredRule[] {
  return result.triggered;
}

function rule(action: FraudAction): TriggeredRule {
  return {
    rule: FRAUD_RULES.USER_CONVERSION_VELOCITY,
    observed: 1,
    threshold: 0,
    weight: 1,
    action,
    detail: '',
  };
}
