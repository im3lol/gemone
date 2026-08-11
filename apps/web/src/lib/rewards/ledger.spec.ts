import { describe as suite, expect, it } from 'vitest';
import type { RewardTransactionRecord, RewardTransactionType } from '@gemone/contracts';

import {
  LEDGER_TYPES,
  absoluteDate,
  describe,
  formatPoints,
  glyph,
  relativeTime,
  statusOf,
} from './ledger';

/**
 * These functions decide what a user is told about their own money, which is
 * why they are a module with tests rather than expressions inside a template.
 */

const NOW = '2026-08-11T12:00:00.000Z';

function record(over: Partial<RewardTransactionRecord> = {}): RewardTransactionRecord {
  return {
    id: 'tx_1',
    userId: 'user_1',
    type: 'CONVERSION_CREDIT',
    amountPoints: 1200,
    pendingDelta: 1200,
    availableDelta: 0,
    lockedDelta: 0,
    sourceType: 'CONVERSION',
    sourceId: 'conv_1',
    sourceLabel: 'Quick Survey',
    sourceTransactionId: null,
    actorType: 'SYSTEM',
    actorId: null,
    reason: null,
    maturesAt: '2026-08-18T12:00:00.000Z',
    holdPeriodDays: 7,
    createdAt: '2026-08-11T11:00:00.000Z',
    ...over,
  };
}

suite('describe', () => {
  it('says what happened in the user’s vocabulary, not the enum’s', () => {
    expect(describe('CONVERSION_CREDIT')).toBe('Offer completed');
    expect(describe('PAYOUT_SETTLE')).toBe('Withdrawal paid');
  });

  it('covers every type in the contract', () => {
    for (const type of LEDGER_TYPES) {
      expect(describe(type)).not.toBe('Account movement');
      expect(glyph(type)).not.toBe('✨');
    }
  });

  it('falls back rather than rendering undefined for a type it has never seen', () => {
    // A newer API is free to send one. The user must not read "undefined"
    // in a table of their own money.
    const unknown = 'SOMETHING_NEW' as RewardTransactionType;

    expect(describe(unknown)).toBe('Account movement');
    expect(glyph(unknown)).toBe('✨');
  });
});

suite('statusOf', () => {
  it('calls a credit that landed in pending "Pending"', () => {
    expect(statusOf(record())).toEqual({ label: 'Pending', tone: 'warning' });
  });

  it('calls a credit that landed straight in available "Available"', () => {
    const immediate = record({ pendingDelta: 0, availableDelta: 1200, holdPeriodDays: 0 });

    expect(statusOf(immediate)).toEqual({ label: 'Available', tone: 'success' });
  });

  it('treats a credit held indefinitely as pending, not as never', () => {
    // maturesAt === null means "a human decides", ARCHITECTURE.md §9.4.
    expect(statusOf(record({ maturesAt: null, holdPeriodDays: null })).label).toBe('Pending');
  });

  it('does not consult the clock: a matured-by-date credit is still pending', () => {
    // Until a REWARD_MATURATION exists the points have not moved, and a status
    // that disagreed with the balance would be the worse of the two lies.
    const overdue = record({ maturesAt: '2026-08-01T00:00:00.000Z' });

    expect(statusOf(overdue).label).toBe('Pending');
  });

  it('maps the three payout movements to what happened to the withdrawal', () => {
    const lock = record({ type: 'PAYOUT_LOCK', pendingDelta: 0 });
    const settle = record({ type: 'PAYOUT_SETTLE', pendingDelta: 0 });
    const refund = record({ type: 'PAYOUT_REFUND', pendingDelta: 0 });

    expect(statusOf(lock)).toEqual({ label: 'In review', tone: 'info' });
    expect(statusOf(settle)).toEqual({ label: 'Paid', tone: 'success' });
    expect(statusOf(refund)).toEqual({ label: 'Returned', tone: 'neutral' });
  });

  it('marks a chargeback as reversed', () => {
    const back = record({
      type: 'CHARGEBACK_DEBIT',
      amountPoints: -1200,
      pendingDelta: -1200,
    });

    expect(statusOf(back)).toEqual({ label: 'Reversed', tone: 'error' });
  });

  it('gives every contract type a status', () => {
    for (const type of LEDGER_TYPES) {
      expect(statusOf(record({ type })).label).not.toBe('Recorded');
    }
  });
});

suite('formatPoints', () => {
  it('groups thousands', () => {
    expect(formatPoints(1200)).toBe('1,200');
    expect(formatPoints(1234567)).toBe('1,234,567');
  });

  it('adds an explicit sign only when asked', () => {
    expect(formatPoints(1200, { signed: true })).toBe('+1,200');
    expect(formatPoints(-1200, { signed: true })).toBe('-1,200');
    expect(formatPoints(-1200)).toBe('-1,200');
  });

  it('leaves zero unsigned — a maturation earned nobody anything', () => {
    expect(formatPoints(0, { signed: true })).toBe('0');
  });
});

suite('relativeTime', () => {
  it('walks the documented ladder', () => {
    expect(relativeTime('2026-08-11T11:59:30.000Z', NOW)).toBe('just now');
    expect(relativeTime('2026-08-11T11:55:00.000Z', NOW)).toBe('5 minutes ago');
    expect(relativeTime('2026-08-11T11:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(relativeTime('2026-08-11T09:00:00.000Z', NOW)).toBe('3 hours ago');
    expect(relativeTime('2026-08-10T09:00:00.000Z', NOW)).toBe('Yesterday');
    expect(relativeTime('2026-08-07T09:00:00.000Z', NOW)).toBe('4 days ago');
  });

  it('singularises one minute and one hour', () => {
    expect(relativeTime('2026-08-11T11:58:30.000Z', NOW)).toBe('1 minute ago');
  });

  it('falls back to an absolute date beyond a week', () => {
    expect(relativeTime('2026-06-02T09:00:00.000Z', NOW)).toBe('2 Jun 2026');
  });

  it('says "just now" for a timestamp slightly in the future', () => {
    // API and web can disagree by a second or two. "in 2 seconds" is worse.
    expect(relativeTime('2026-08-11T12:00:02.000Z', NOW)).toBe('just now');
  });

  it('returns an empty string rather than "Invalid Date" for junk', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
    expect(absoluteDate('not-a-date')).toBe('');
  });
});

suite('absoluteDate', () => {
  it('is unambiguous in both date conventions', () => {
    expect(absoluteDate('2026-08-11T12:00:00.000Z')).toBe('11 Aug 2026');
  });
});
