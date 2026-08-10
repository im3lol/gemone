import { describe, expect, it } from 'vitest';

import { __testing } from './postback-intake.service';

const { isUniqueViolation, clampLimit, DEFAULT_LIMIT, MAX_LIMIT } = __testing;

describe('recognising the idempotency constraint firing', () => {
  it('recognises Prisma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
  });

  it.each([
    ['a connection failure', { code: 'P1001' }],
    ['a plain error', new Error('boom')],
    ['a string', 'P2002'],
    ['null', null],
    ['undefined', undefined],
  ])('does not mistake %s for a duplicate', (_label, error) => {
    /*
     * The narrowness is the point. A broad `catch` that assumed every failure
     * was a duplicate would answer 200 to a provider while the database was
     * down — and a postback acknowledged but never stored is a conversion
     * nobody can pay and nobody can find.
     */
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_LIMIT);
    expect(clampLimit(50)).toBe(50);
  });
});
