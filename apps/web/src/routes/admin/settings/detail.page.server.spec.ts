import { describe, expect, it } from 'vitest';

import { __testing } from './[key]/+page.server';

const { reason, isStale, readScopeId, scopeFrom } = __testing;

describe('reason', () => {
  it('prefers the schema message over the envelope', () => {
    /*
     * For a configuration value the field message *is* the key's own Zod
     * schema speaking — the only place the rule is written. "Validation
     * failed" tells an operator something was wrong without saying what.
     */
    expect(
      reason({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: [{ field: 'value', message: 'Number must be less than or equal to 180' }],
      }),
    ).toBe('value: Number must be less than or equal to 180');
  });

  it('falls back to the envelope when there are no fields', () => {
    expect(
      reason({ status: 404, code: 'CONFIG_KEY_UNKNOWN', message: 'Unknown configuration key' }),
    ).toBe('Unknown configuration key');
  });
});

describe('isStale', () => {
  it('recognises the refusal that means somebody else changed the key', () => {
    // Matched on the API's own code, not on the status — 409 is right and is
    // not exclusive to this — and not on the message, which would break the
    // moment the sentence is reworded.
    expect(
      isStale({ status: 409, code: 'CONFIG_STALE_WRITE', message: 'changed by someone else' }),
    ).toBe(true);
  });

  it('leaves every other refusal alone', () => {
    // The recovery differs: these are fixed by editing what was typed.
    expect(isStale({ status: 422, code: 'CONFIG_INVALID_VALUE', message: 'too big' })).toBe(false);
    expect(isStale({ status: 409, code: 'SOMETHING_ELSE', message: 'conflict' })).toBe(false);
  });
});

/**
 * Editing one provider's override — TODO T87.
 *
 * Every guard is the API's; these cover the two decisions this layer makes,
 * which are what it forwards and what it drops.
 */
describe('readScopeId', () => {
  const ID = '019ff3c8-685d-755b-a300-24dfdd698820';

  it('accepts a provider id', () => {
    expect(readScopeId(ID)).toBe(ID);
  });

  it('is the global scope when no provider is named', () => {
    expect(readScopeId(null)).toBe('');
    expect(readScopeId('')).toBe('');
  });

  it('drops a malformed id instead of forwarding it', () => {
    // The API's `scopeId` is `@IsUUID`, so a malformed one is a 422 — on a
    // *load* that replaces a working page with an error screen, over a query
    // parameter somebody edited.
    expect(readScopeId('not-a-uuid')).toBe('');
    expect(readScopeId(`${ID}x`)).toBe('');
  });
});

describe('scopeFrom', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };

  it('writes globally when no provider is named', () => {
    // And sends no `scopeId` at all: `assertScopeTargetExists` refuses one on
    // a global write, correctly — a global row has nowhere to put it.
    expect(scopeFrom(form({ scopeId: '' }))).toEqual({ scope: 'GLOBAL' });
    expect(scopeFrom(form({}))).toEqual({ scope: 'GLOBAL' });
  });

  it('writes at provider scope when one is named', () => {
    expect(scopeFrom(form({ scopeId: 'p1' }))).toEqual({ scope: 'PROVIDER', scopeId: 'p1' });
  });
});
