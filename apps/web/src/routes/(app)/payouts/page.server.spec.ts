import { describe as suite, expect, it } from 'vitest';

import type { ApiFailure } from '$lib/server/api';

import { __testing } from './+page.server';

const { describe } = __testing;

const failure = (over: Partial<ApiFailure>): ApiFailure => ({
  status: 422,
  code: 'INTERNAL_ERROR',
  message: 'Something happened',
  ...over,
});

/**
 * This decides *where* an API refusal is shown, which is the whole difference
 * between a form that points at the problem and a banner above a form the user
 * now has to re-read to find it.
 */
suite('describe', () => {
  it('puts a validation failure on the fields the API named', () => {
    const result = describe(
      failure({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        fields: [
          { field: 'amountPoints', message: 'must not be less than 1' },
          { field: 'destination', message: 'must be shorter than 200 characters' },
        ],
      }),
    );

    expect(result.fields).toEqual({
      amountPoints: 'must not be less than 1',
      destination: 'must be shorter than 200 characters',
    });
    // Not in both places: the same sentence twice trains people to ignore the
    // region that matters.
    expect(result.message).toBeNull();
  });

  it('ignores a field name that is not on this form', () => {
    // The action posts three properties; anything else in a `fields` array is
    // about a request this form did not make, and rendering it would attach a
    // message to no control at all.
    const result = describe(
      failure({ code: 'VALIDATION_ERROR', fields: [{ field: 'userId', message: 'nope' }] }),
    );

    expect(result.fields).toEqual({});
    expect(result.message).toBe('Something happened');
  });

  it('attaches a domain refusal to the control it is about', () => {
    expect(
      describe(
        failure({
          code: 'PAYOUT_AMOUNT_OUT_OF_RANGE',
          message: 'A withdrawal must be between 1000 and 500000 points',
        }),
      ),
    ).toEqual({
      message: null,
      fields: { amountPoints: 'A withdrawal must be between 1000 and 500000 points' },
    });

    expect(describe(failure({ code: 'PAYOUT_METHOD_UNSUPPORTED' })).fields).toEqual({
      method: 'Something happened',
    });

    expect(describe(failure({ code: 'PAYOUT_DESTINATION_INVALID' })).fields).toEqual({
      destination: 'Something happened',
    });
  });

  it('keeps a refusal about the whole request above the form', () => {
    /*
     * An insufficient balance and the daily cap are not about a malformed
     * field — pinning them to the amount would say the number is wrong when
     * the number is fine and the account is not.
     */
    for (const code of [
      'REWARD_INSUFFICIENT_BALANCE',
      'PAYOUT_DAILY_LIMIT_REACHED',
      'SERVICE_UNAVAILABLE',
    ]) {
      const result = describe(failure({ code, message: 'Not enough available points' }));

      expect(result.fields, code).toEqual({});
      expect(result.message, code).toBe('Not enough available points');
    }
  });

  it('never leaves a failure with nothing to show', () => {
    // A refusal that renders neither a field error nor a banner is a form that
    // did nothing when the button was pressed.
    const result = describe(failure({}));

    expect(Boolean(result.message) || Object.keys(result.fields).length > 0).toBe(true);
  });
});
