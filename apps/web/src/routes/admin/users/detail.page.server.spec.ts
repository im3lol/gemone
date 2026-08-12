import { USER_STATUSES } from '@gemone/contracts';
import { describe, expect, it } from 'vitest';

import { __testing } from './[id]/+page.server';

const { readStatus, reason } = __testing;

describe('readStatus', () => {
  it.each(Object.values(USER_STATUSES))('forwards %s', (status) => {
    expect(readStatus(status)).toBe(status);
  });

  it('refuses anything the contract does not define', () => {
    // The API validates it too — that is the control. This keeps a value that
    // is certain to be a 422 from being sent at all.
    expect(readStatus('DELETED')).toBe(null);
    expect(readStatus('')).toBe(null);
  });
});

describe('reason', () => {
  it('prefers the field message over the envelope', () => {
    // "Validation failed" tells an operator something was wrong without
    // saying what. The sentence worth reading is on the field.
    expect(
      reason({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: [{ field: 'reason', message: 'must explain the change in at least 8 characters' }],
      }),
    ).toBe('reason: must explain the change in at least 8 characters');
  });

  it('falls back to the envelope when there are no fields', () => {
    expect(
      reason({
        status: 403,
        code: 'ADMIN_SELF_ACTION_FORBIDDEN',
        message: 'You cannot change your own account status',
      }),
    ).toBe(
      'You cannot change your own account status',
    );
  });

  it('joins several field messages', () => {
    expect(
      reason({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: [
          { field: 'status', message: 'must be one of: ACTIVE' },
          { field: 'reason', message: 'is required' },
        ],
      }),
    ).toBe('status: must be one of: ACTIVE; reason: is required');
  });
});
