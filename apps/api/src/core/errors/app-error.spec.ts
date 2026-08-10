import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@gemone/contracts';

import {
  DomainError,
  InfrastructureError,
  ValidationError,
  isAppError,
} from './app-error';

/**
 * The taxonomy is worth testing because the three families are the input to
 * three separate decisions — HTTP status, log level, and retryability — and
 * getting any of them wrong is silent. A DomainError logged at `error` trains
 * everyone to ignore the error log; an InfrastructureError marked
 * non-retryable turns a transient blip into a lost job.
 */
describe('error taxonomy', () => {
  describe('ValidationError', () => {
    it('is a non-retryable 422 logged at debug', () => {
      const error = new ValidationError();

      expect(error.family).toBe('validation');
      expect(error.httpStatus).toBe(422);
      expect(error.logLevel).toBe('debug');
      expect(error.retryable).toBe(false);
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('carries per-field detail, the only family that does', () => {
      const error = new ValidationError('Invalid input', [
        { field: 'email', message: 'must be an email' },
      ]);

      expect(error.fields).toEqual([{ field: 'email', message: 'must be an email' }]);
    });

    it('defaults to an empty field list rather than undefined', () => {
      expect(new ValidationError().fields).toEqual([]);
    });
  });

  describe('DomainError', () => {
    it('is logged at info because it is an expected outcome, not a fault', () => {
      const error = new DomainError(ERROR_CODES.FORBIDDEN, 'Insufficient balance');

      expect(error.family).toBe('domain');
      expect(error.logLevel).toBe('info');
      expect(error.retryable).toBe(false);
    });

    it('defaults to 409 but allows the caller to choose', () => {
      expect(new DomainError(ERROR_CODES.FORBIDDEN, 'x').httpStatus).toBe(409);
      expect(new DomainError(ERROR_CODES.FORBIDDEN, 'x', 403).httpStatus).toBe(403);
    });
  });

  describe('InfrastructureError', () => {
    it('is retryable by default — most dependency failures are transient', () => {
      const error = new InfrastructureError('Database unreachable');

      expect(error.family).toBe('infrastructure');
      expect(error.httpStatus).toBe(500);
      expect(error.logLevel).toBe('error');
      expect(error.retryable).toBe(true);
    });

    it('allows retryable to be overridden — bad credentials will not fix themselves', () => {
      const error = new InfrastructureError('Provider rejected our credentials', {
        retryable: false,
        httpStatus: 502,
      });

      expect(error.retryable).toBe(false);
      expect(error.httpStatus).toBe(502);
    });

    it('preserves the underlying cause for the log', () => {
      const cause = new Error('ECONNREFUSED');
      const error = new InfrastructureError('Redis unreachable', { cause });

      expect(error.cause).toBe(cause);
    });
  });

  describe('isAppError', () => {
    it('recognises every family', () => {
      expect(isAppError(new ValidationError())).toBe(true);
      expect(isAppError(new DomainError(ERROR_CODES.NOT_FOUND, 'x'))).toBe(true);
      expect(isAppError(new InfrastructureError('x'))).toBe(true);
    });

    it('rejects plain errors and non-errors, so they fall through to a 500', () => {
      expect(isAppError(new Error('boom'))).toBe(false);
      expect(isAppError('boom')).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
    });
  });

  it('keeps context out of the message, so it cannot leak into a response', () => {
    const error = new DomainError(ERROR_CODES.FORBIDDEN, 'Insufficient balance', 409, {
      userId: 'u-1',
      requested: 500,
    });

    expect(error.message).toBe('Insufficient balance');
    expect(error.context).toEqual({ userId: 'u-1', requested: 500 });
  });

  it('names each error after its own class, for readable logs', () => {
    expect(new ValidationError().name).toBe('ValidationError');
    expect(new DomainError(ERROR_CODES.NOT_FOUND, 'x').name).toBe('DomainError');
    expect(new InfrastructureError('x').name).toBe('InfrastructureError');
  });
});
