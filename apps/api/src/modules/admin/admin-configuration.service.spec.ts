import { ADMIN_ACTIONS, CONFIG_SCOPES } from '@gemone/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminConfigurationService, __testing } from './admin-configuration.service';

const { matchesSearch, auditTargetId } = __testing;

/**
 * **The ordering invariant this whole layer exists to get right** — D51.
 *
 * The cache is dropped *after* the transaction commits. Dropping it inside
 * would be worse than never dropping it: between the invalidation and the
 * commit the new value is invisible to other connections, so a concurrent read
 * loads the *old* value into the freshly-emptied cache and leaves it there
 * until the process restarts.
 *
 * That failure is silent, survives every request, and looks exactly like "the
 * admin panel does not work". It has no other test — an integration test cannot
 * reliably hit a window this small, so the ordering is asserted directly.
 */
describe('cache invalidation happens after the commit', () => {
  it('does not invalidate while the transaction is still open', async () => {
    const events: string[] = [];

    const configuration = {
      set: vi.fn(async () => {
        events.push('set');
        return {
          key: 'rewards.hold_period_days',
          scope: 'GLOBAL' as const,
          scopeId: '',
          previousValue: 14,
          value: 30,
        };
      }),
      invalidateAndBroadcast: vi.fn(async () => {
        events.push('invalidate');
      }),
      getDefinition: vi.fn(() => definition()),
      resolve: vi.fn(async () => ({
        key: 'rewards.hold_period_days',
        value: 30,
        source: 'GLOBAL' as const,
        scopeId: null,
      })),
      storedValues: vi.fn(async () => []),
      history: vi.fn(async () => []),
      overrideCounts: vi.fn(async () => new Map<string, { stored: number; provider: number }>()),
    };

    const prisma = {
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
        const result = await run({});
        events.push('commit');
        return result;
      }),
    };

    const audit = {
      record: vi.fn(async () => {
        events.push('audit');
      }),
    };

    const service = new AdminConfigurationService(
      prisma as never,
      configuration as never,
      { findById: vi.fn() } as never,
      audit as never,
    );

    await service.set(
      'rewards.hold_period_days',
      30,
      { reason: 'shorter hold for a reliable network' },
      { adminId: 'admin-1', ip: '198.51.100.1' },
    );

    /*
     * The whole assertion. `set` and `audit` are inside; `invalidate` comes
     * after `commit`. Asserting the sequence rather than "invalidate was
     * called" is what makes this catch the bug — a version that invalidates
     * inside the transaction calls it exactly as many times.
     *
     * Since §14.3 the same call also broadcasts, so this now guards two things
     * with one sequence: the local cache is not emptied before the commit, and
     * no other process is invited to re-read before the commit either. The
     * second is the more expensive one to get wrong — it multiplies one stale
     * copy by the number of running processes.
     */
    expect(events).toEqual(['set', 'audit', 'commit', 'invalidate']);
  });

  it('writes the value and the audit entry through the same transaction client', async () => {
    /*
     * DATABASE.md §3.7: the audit entry is "written inside the same transaction
     * as the action it records" — an entry written afterward can be lost
     * precisely when it matters, when the action succeeded and something then
     * failed.
     */
    const tx = { marker: 'the-transaction' };

    const configuration = {
      set: vi.fn(async (..._args: unknown[]) => ({
        key: 'payouts.minimum_points',
        scope: 'GLOBAL' as const,
        scopeId: '',
        previousValue: 1000,
        value: 500,
      })),
      invalidateAndBroadcast: vi.fn(async () => undefined),
      getDefinition: vi.fn(() => definition()),
      resolve: vi.fn(async () => ({
        key: 'payouts.minimum_points',
        value: 500,
        source: 'GLOBAL' as const,
        scopeId: null,
      })),
      storedValues: vi.fn(async () => []),
      history: vi.fn(async () => []),
      overrideCounts: vi.fn(async () => new Map<string, { stored: number; provider: number }>()),
    };

    const audit = { record: vi.fn(async (..._args: unknown[]) => undefined) };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(tx)),
    };

    const service = new AdminConfigurationService(
      prisma as never,
      configuration as never,
      { findById: vi.fn() } as never,
      audit as never,
    );

    await service.set(
      'payouts.minimum_points',
      500,
      { reason: 'lowering the floor for the pilot' },
      { adminId: 'admin-1', ip: null },
    );

    expect(configuration.set.mock.calls[0]?.[3]).toBe(tx);
    expect(audit.record.mock.calls[0]?.[0]).toBe(tx);
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      action: ADMIN_ACTIONS.CONFIGURATION_CHANGED,
      targetType: 'configuration',
      before: { value: 1000 },
      after: { value: 500 },
      reason: 'lowering the floor for the pilot',
    });
  });

  it('audits nothing when a reset removed nothing', async () => {
    /*
     * `unset` returns null when there was no override. An audit entry for a
     * change that did not happen is noise in the one log that has to stay
     * readable — and it would show a before and after that were identical.
     */
    const configuration = {
      unset: vi.fn(async () => null),
      invalidateAndBroadcast: vi.fn(async () => undefined),
      getDefinition: vi.fn(() => definition()),
      resolve: vi.fn(async () => ({
        key: 'rewards.hold_period_days',
        value: 14,
        source: 'default' as const,
        scopeId: null,
      })),
      storedValues: vi.fn(async () => []),
      history: vi.fn(async () => []),
      overrideCounts: vi.fn(async () => new Map<string, { stored: number; provider: number }>()),
    };

    const audit = { record: vi.fn(async () => undefined) };
    const prisma = {
      $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run({})),
    };

    const service = new AdminConfigurationService(
      prisma as never,
      configuration as never,
      { findById: vi.fn() } as never,
      audit as never,
    );

    await service.reset(
      'rewards.hold_period_days',
      { reason: 'back to the default' },
      { adminId: 'admin-1', ip: null },
    );

    expect(audit.record).not.toHaveBeenCalled();

    /*
     * And nothing is broadcast either (§14.3). A no-op reset that told every
     * other process to drop its cache would turn a double-clicked button into
     * a platform-wide re-read of every key it touches — traffic caused by a
     * change that did not happen.
     */
    expect(configuration.invalidateAndBroadcast).not.toHaveBeenCalled();
  });
});

describe('audit target ids', () => {
  it('names the key and its scope, not a row id', () => {
    /*
     * An admin asking "who changed the hold period for this provider?" knows
     * the key and the provider. They have never seen the primary key of a row
     * that may not have existed before the change.
     */
    expect(auditTargetId('rewards.hold_period_days', 'GLOBAL', '')).toBe(
      'rewards.hold_period_days@GLOBAL',
    );
    expect(auditTargetId('rewards.hold_period_days', 'PROVIDER', 'prov-1')).toBe(
      'rewards.hold_period_days@PROVIDER:prov-1',
    );
  });

  it('distinguishes two scopes of the same key', () => {
    // Otherwise the audit log cannot answer "was this the global change or the
    // provider override?" — the question that matters when both moved.
    expect(auditTargetId('k', 'GLOBAL', '')).not.toBe(auditTargetId('k', 'PROVIDER', 'p'));
  });
});

describe('searching the key list', () => {
  const key = {
    key: 'rewards.hold_period_days',
    description: 'Days a conversion credit is held before it becomes withdrawable',
  };

  it('matches on the key name', () => {
    expect(matchesSearch(key as never, 'hold_period')).toBe(true);
  });

  it('matches on the description', () => {
    // An admin looking for "withdrawable" should not have to know the key is
    // spelled `rewards.hold_period_days`.
    expect(matchesSearch(key as never, 'withdrawable')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(matchesSearch(key as never, '  HOLD Period  '.trim())).toBe(false);
    expect(matchesSearch(key as never, '  REWARDS.HOLD  ')).toBe(true);
  });

  it('matches everything when nothing was asked for', () => {
    expect(matchesSearch(key as never, undefined)).toBe(true);
    expect(matchesSearch(key as never, '')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(matchesSearch(key as never, 'payout')).toBe(false);
  });
});

function definition() {
  return {
    key: 'rewards.hold_period_days',
    description: 'Days a conversion credit is held',
    valueType: 'number' as const,
    scopes: [CONFIG_SCOPES.GLOBAL, CONFIG_SCOPES.PROVIDER],
    defaultValue: 14,
    schema: { safeParse: () => ({ success: true, data: 14 }) },
  } as never;
}
