import { describe, expect, it } from 'vitest';

import {
  formatValue,
  versionFor,
  groupByNamespace,
  isSettableAt,
  keyLabel,
  namespaceOf,
  parseValue,
  shadowedBy,
  sourceState,
  toInputValue,
  versionFromField,
  versionToField,
} from './settings';

/**
 * These decide what an operator is shown, and what is sent, when they change a
 * value that alters the platform's economics with no deployment behind it.
 */

const summary = (key: string, overrideCount = 0) =>
  ({
    key,
    description: '',
    valueType: 'number' as const,
    scopes: ['GLOBAL' as const],
    defaultValue: 0,
    effectiveValue: 0,
    source: 'default' as const,
    overrideCount,
  });

describe('sourceState', () => {
  it('names the three sources §4.9 distinguishes', () => {
    expect(sourceState('default').label).toBe('Default');
    expect(sourceState('GLOBAL').label).toBe('Set globally');
    expect(sourceState('PROVIDER').label).toBe('Set for this provider');
  });

  it('says what makes the default different, because that is the point', () => {
    // It is the only case where changing code changes behaviour.
    expect(sourceState('default').hint).toMatch(/code/i);
    expect(sourceState('GLOBAL').hint).not.toMatch(/comes from code/i);
  });

  it('degrades rather than rendering undefined for an unknown source', () => {
    expect(sourceState('SOMETHING' as never).label).toBe('SOMETHING');
  });
});

describe('namespaceOf and keyLabel', () => {
  it('derives the group from the key, so a new namespace needs no change here', () => {
    expect(namespaceOf('rewards.hold_period_days')).toBe('rewards');
    expect(namespaceOf('offers.sync.full_sync_interval_hours')).toBe('offers');
    expect(namespaceOf('undotted')).toBe('undotted');
  });

  it('reads the rest of the key as words', () => {
    expect(keyLabel('rewards.hold_period_days')).toBe('hold period days');
    expect(keyLabel('offers.sync.full_sync_interval_hours')).toBe('sync · full sync interval hours');
  });
});

describe('groupByNamespace', () => {
  it('groups and sorts without being told the namespaces', () => {
    const grouped = groupByNamespace([
      summary('rewards.hold_period_days'),
      summary('auth.login_max_failures_per_ip'),
      summary('rewards.another_key'),
    ]);

    expect(grouped.map((g) => g.namespace)).toEqual(['auth', 'rewards']);
    expect(grouped[1]?.items.map((i) => i.key)).toEqual([
      'rewards.another_key',
      'rewards.hold_period_days',
    ]);
  });

  it('is empty for an empty list rather than throwing', () => {
    expect(groupByNamespace([])).toEqual([]);
  });
});

describe('formatValue', () => {
  it('shows a string unquoted, because an operator reads a currency code', () => {
    expect(formatValue('USD')).toBe('USD');
  });

  it('renders structural values as JSON rather than [object Object]', () => {
    expect(formatValue(['paypal', 'bank'])).toBe('["paypal","bank"]');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  it('names an absent value instead of leaving a cell that reads as unloaded', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('—');
  });

  it('keeps false and zero visible', () => {
    // Both are legitimate values, and both are falsy — the classic way for a
    // settings screen to show an empty box where a real value lives.
    expect(formatValue(false)).toBe('false');
    expect(formatValue(0)).toBe('0');
  });
});

describe('toInputValue', () => {
  it('gives a json key its quotes and its indentation back', () => {
    expect(toInputValue(['paypal'], 'json')).toBe('[\n  "paypal"\n]');
  });

  it('leaves a scalar as the operator would type it', () => {
    expect(toInputValue(14, 'number')).toBe('14');
    expect(toInputValue('USD', 'string')).toBe('USD');
    expect(toInputValue(true, 'boolean')).toBe('true');
  });
});

describe('parseValue', () => {
  it('converts to the type the key declares', () => {
    expect(parseValue('14', 'number')).toEqual({ ok: true, value: 14 });
    expect(parseValue('true', 'boolean')).toEqual({ ok: true, value: true });
    expect(parseValue('false', 'boolean')).toEqual({ ok: true, value: false });
    expect(parseValue('USD', 'string')).toEqual({ ok: true, value: 'USD' });
    expect(parseValue('["paypal"]', 'json')).toEqual({ ok: true, value: ['paypal'] });
  });

  it('keeps zero and negative numbers, which a truthiness check would lose', () => {
    expect(parseValue('0', 'number')).toEqual({ ok: true, value: 0 });
    expect(parseValue('-5', 'number')).toEqual({ ok: true, value: -5 });
  });

  it('hands an unparseable number on as typed, so the key schema answers', () => {
    // `Number('abc')` is NaN. Inventing a message here would be a range rule
    // written in the copy no test runs against a real write; the schema's own
    // refusal is the sentence that stays right when the schema changes.
    expect(parseValue('abc', 'number')).toEqual({ ok: true, value: 'abc' });
    expect(parseValue('', 'number')).toEqual({ ok: true, value: '' });
  });

  it('refuses malformed JSON locally, because syntax is knowable without the rule', () => {
    const result = parseValue('[paypal', 'json');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/valid JSON/i);
  });

  it('accepts a JSON scalar, since a json key may hold one', () => {
    expect(parseValue('42', 'json')).toEqual({ ok: true, value: 42 });
    expect(parseValue('null', 'json')).toEqual({ ok: true, value: null });
  });
});

describe('shadowedBy', () => {
  it('reports the provider overrides that would win over a global change', () => {
    // Read from the API's own count. A global write while overrides exist
    // changes the value for everyone except the providers most likely to be
    // the reason someone opened the key.
    expect(shadowedBy(summary('k', 3))).toBe(3);
    expect(shadowedBy(summary('k', 0))).toBe(0);
  });
});

describe('isSettableAt', () => {
  it('respects the scopes the key declares', () => {
    // A key meaningless per provider must not be settable per provider, or the
    // resolution chain returns a value nobody intended.
    expect(isSettableAt(['GLOBAL'], 'GLOBAL')).toBe(true);
    expect(isSettableAt(['GLOBAL'], 'PROVIDER')).toBe(false);
    expect(isSettableAt(['GLOBAL', 'PROVIDER'], 'PROVIDER')).toBe(true);
  });
});

/**
 * The write precondition — TODO T88.
 *
 * These decide whether one administrator can silently overwrite another's
 * change, which is the whole of what T88 is about.
 */
describe('versionFor', () => {
  const detail = (overrides: { scope: string; scopeId: string; updatedAt: string }[]) =>
    ({ overrides }) as never;

  const GLOBAL_ROW = { scope: 'GLOBAL', scopeId: '', updatedAt: '2026-08-12T10:00:00.000Z' };
  const PROVIDER_ROW = { scope: 'PROVIDER', scopeId: 'p1', updatedAt: '2026-08-12T11:00:00.000Z' };

  it('reads the version of the stored global row', () => {
    expect(versionFor(detail([GLOBAL_ROW]), '')).toBe(GLOBAL_ROW.updatedAt);
  });

  it('is null when nothing is stored at that scope', () => {
    // Not an absence of opinion: "I read a key with nothing stored" is a real
    // thing to have read, and the state a first write is made from.
    expect(versionFor(detail([]), '')).toBe(null);
    expect(versionFor(detail([GLOBAL_ROW]), 'p1')).toBe(null);
  });

  it('keeps the scopes apart, because they are different rows', () => {
    /*
     * A key can hold a global row and one per provider at once, each with its
     * own `updatedAt`. Asserting a global version while writing a provider
     * override would compare two different rows and pass whenever either had
     * not moved.
     */
    const both = detail([GLOBAL_ROW, PROVIDER_ROW]);

    expect(versionFor(both, '')).toBe(GLOBAL_ROW.updatedAt);
    expect(versionFor(both, 'p1')).toBe(PROVIDER_ROW.updatedAt);
    expect(versionFor(both, 'p2')).toBe(null);
  });
});

describe('versionToField and versionFromField', () => {
  it('round-trips a stored version through a hidden input', () => {
    const version = '2026-08-12T10:00:00.000Z';

    expect(versionFromField(versionToField(version))).toBe(version);
  });

  it('round-trips "nothing stored" as null, not as an empty string', () => {
    // A hidden input can only hold a string, and the empty string is never a
    // valid timestamp — so nothing legitimate collides with the sentinel.
    expect(versionToField(null)).toBe('');
    expect(versionFromField('')).toBe(null);
  });
});
