import { describe, expect, it } from 'vitest';

import { __testing } from './[key]/+page.server';

const { reason } = __testing;

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
