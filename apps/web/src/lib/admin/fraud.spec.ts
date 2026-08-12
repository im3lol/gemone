import { FRAUD_RULES } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { FRAUD_DECISIONS, ruleLabel, shortId, waitingDays, waitingLabel } from './fraud';

/**
 * These decide what an operator is told before they release or reverse
 * somebody's points, which is why they are a module with tests rather than
 * expressions inside a template.
 */

const NOW = '2026-08-12T12:00:00.000Z';

describe('ruleLabel', () => {
  it('gives every rule in the contract a sentence', () => {
    for (const rule of Object.values(FRAUD_RULES)) {
      const label = ruleLabel(rule);

      expect(label).not.toBe('');
      // The stored identifier is terse because it is stored. A screen that
      // showed it raw would be asking the operator to read the database.
      expect(label).not.toBe(rule);
    }
  });

  it('degrades readably for a rule this build has never heard of', () => {
    // A newer API can fire a rule added after this build shipped. Rendering
    // `undefined` beside a held reward is the alternative.
    expect(ruleLabel('BRAND_NEW_RULE' as never)).toBe('brand new rule');
  });

  it('never claims a measurement was suspicious', () => {
    // How suspicious a number is depends on the threshold that applied when it
    // was measured, which is snapshotted on the evaluation and not here. A
    // label that judged would be a fraud rule written in a label file.
    for (const rule of Object.values(FRAUD_RULES)) {
      expect(ruleLabel(rule)).not.toMatch(/suspicious|fraud|abuse|risky/i);
    }
  });
});

describe('FRAUD_DECISIONS', () => {
  it('offers exactly the two decisions the API accepts', () => {
    expect(FRAUD_DECISIONS.map((item) => item.decision)).toEqual(['CLEAR', 'CONFIRM']);
  });

  it('names the SvelteKit action after the decision', () => {
    // One name for one edge, all the way through: `?/clear` posts `CLEAR`.
    for (const item of FRAUD_DECISIONS) {
      expect(item.action).toBe(item.decision.toLowerCase());
    }
  });

  it('says what each decision does to the points before it is done', () => {
    const [clear, confirm] = FRAUD_DECISIONS;

    expect(clear?.hint).toMatch(/mature|withdrawable/i);
    expect(confirm?.hint).toMatch(/reversed|leave/i);
    // Opposite directions, so they cannot share a tone.
    expect(clear?.variant).not.toBe(confirm?.variant);
  });
});

describe('waitingDays', () => {
  it('counts whole days of waiting', () => {
    expect(waitingDays('2026-08-12T09:00:00.000Z', NOW)).toBe(0);
    expect(waitingDays('2026-08-11T09:00:00.000Z', NOW)).toBe(1);
    expect(waitingDays('2026-07-29T12:00:00.000Z', NOW)).toBe(14);
  });

  it('does not go negative on a clock skew', () => {
    // The API and this process can disagree by a second or two. "Held -1 days
    // ago" is worse than "held today".
    expect(waitingDays('2026-08-12T12:00:05.000Z', NOW)).toBe(0);
  });

  it('is zero for an unparseable date rather than NaN', () => {
    expect(waitingDays('not-a-date', NOW)).toBe(0);
    expect(waitingDays(NOW, 'not-a-date')).toBe(0);
  });
});

describe('waitingLabel', () => {
  it('escalates its tone as a hold ages', () => {
    // A hold from this morning is normal. One that has sat a fortnight is the
    // queue failing at its only job, which is emptying.
    expect(waitingLabel('2026-08-12T09:00:00.000Z', NOW).tone).toBe('neutral');
    expect(waitingLabel('2026-08-09T12:00:00.000Z', NOW).tone).toBe('warning');
    expect(waitingLabel('2026-07-29T12:00:00.000Z', NOW).tone).toBe('error');
  });

  it('reads as a phrase, not as a number', () => {
    expect(waitingLabel('2026-08-11T12:00:00.000Z', NOW).text).toBe('Held yesterday');
    expect(waitingLabel('2026-07-29T12:00:00.000Z', NOW).text).toBe('Held 14 days ago');
  });
});

describe('shortId', () => {
  it('shortens a uuid to something a column can hold', () => {
    expect(shortId('0198f2c1-4a0e-7c3a-9f2b-5d6e7a8b9c0d')).toBe('0198f2c1…');
  });

  it('leaves anything already short alone', () => {
    expect(shortId('abc123')).toBe('abc123');
  });
});
