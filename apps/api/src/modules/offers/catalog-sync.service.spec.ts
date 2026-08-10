import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import { ProviderUnavailableError } from '../providers/contracts/provider-errors';
import { __testing } from './catalog-sync.service';

const { describeFailure } = __testing;

/**
 * What a failed run tells the person reading it.
 *
 * This string is stored on the run and rendered on an admin screen, so it is
 * part of the product rather than a log line — and it is the only explanation
 * available months later, once the logs have rotated.
 */
describe('describeFailure', () => {
  it('leads with the stable error code, not the class name', () => {
    const summary = describeFailure(
      new DomainError(ERROR_CODES.PROVIDER_DISABLED, 'Provider "x" is disabled', 409),
    );

    /*
     * `DomainError: ...` names a TypeScript class an admin has no reason to
     * know and that a refactor can rename. The code is the part of the
     * contract that is stable (§15.2) and the part that says what happened.
     */
    expect(summary).toContain(ERROR_CODES.PROVIDER_DISABLED);
    expect(summary).not.toContain('DomainError');
  });

  it('does the same for the normalized provider failures', () => {
    const summary = describeFailure(
      new ProviderUnavailableError('acme', 'Connection reset'),
    );

    expect(summary).toContain(ERROR_CODES.PROVIDER_UNAVAILABLE);
    expect(summary).toContain('Connection reset');
  });

  it('falls back to the class name only outside the taxonomy', () => {
    // A genuine programming error, where the class name is the most useful
    // thing left. Full detail is in the log, joined by correlation id.
    expect(describeFailure(new TypeError('x is not a function'))).toContain('TypeError');
  });

  it('survives something that is not an Error at all', () => {
    expect(describeFailure('a string was thrown')).toBe('a string was thrown');
    expect(() => describeFailure(undefined)).not.toThrow();
  });

  it('bounds the length', () => {
    // The column is text, but an admin screen is not, and a provider echoing
    // a megabyte of HTML back at us should not land in the database.
    expect(describeFailure(new Error('x'.repeat(10_000))).length).toBeLessThanOrEqual(500);
  });

  it('never carries a stack trace', () => {
    const error = new Error('boom');
    expect(describeFailure(error)).not.toContain('at ');
    expect(describeFailure(error)).not.toContain(__filename);
  });
});
