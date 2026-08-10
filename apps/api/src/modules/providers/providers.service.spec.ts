import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../core/errors/app-error';
import { ProvidersService, __testing } from './providers.service';

const { normalizeIpRanges, validateSyncInterval, requireDisplayName } = __testing;

/**
 * The write-time rules, without a database.
 *
 * All three exist for the same reason: a value that is wrong here does not
 * fail loudly later. A malformed IP range quarantines every legitimate
 * postback; a sync interval of one minute burns a provider's API quota; a
 * 4000-character display name breaks an admin screen. None of them throws at
 * the moment the damage happens.
 */
describe('provider row validation', () => {
  describe('normalizeIpRanges', () => {
    it('accepts addresses and CIDR blocks', () => {
      expect(normalizeIpRanges(['203.0.113.10', '198.51.100.0/24'])).toEqual([
        '203.0.113.10',
        '198.51.100.0/24',
      ]);
    });

    it('trims and de-duplicates', () => {
      expect(normalizeIpRanges([' 203.0.113.10 ', '203.0.113.10'])).toEqual([
        '203.0.113.10',
      ]);
    });

    it('treats an absent list as empty rather than as an error', () => {
      expect(normalizeIpRanges(undefined)).toEqual([]);
    });

    it('rejects a malformed range, naming every bad value at once', () => {
      try {
        normalizeIpRanges(['203.0.113.10', 'not-an-ip', '10.0.0.0/99']);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).fields[0]!.message).toContain('not-an-ip');
        expect((error as ValidationError).fields[0]!.message).toContain('10.0.0.0/99');
      }
    });

    it('bounds the list', () => {
      expect(() => normalizeIpRanges(Array(65).fill('203.0.113.10'))).toThrow(ValidationError);
    });
  });

  describe('validateSyncInterval', () => {
    it('accepts a value inside the bounds', () => {
      expect(validateSyncInterval(60)).toBe(60);
    });

    it('leaves an omitted value alone so the column default applies', () => {
      expect(validateSyncInterval(undefined)).toBeUndefined();
    });

    it.each([0, 1, 4, 1441, 2.5, Number.NaN])('rejects %s', (value) => {
      // Below the floor we hammer a provider's API; above the ceiling the
      // catalog is stale enough to show offers that no longer exist.
      expect(() => validateSyncInterval(value)).toThrow(ValidationError);
    });
  });

  describe('requireDisplayName', () => {
    it('trims', () => {
      expect(requireDisplayName('  Acme  ')).toBe('Acme');
    });

    it('rejects blank and over-long names', () => {
      expect(() => requireDisplayName('   ')).toThrow(ValidationError);
      expect(() => requireDisplayName('x'.repeat(101))).toThrow(ValidationError);
    });
  });
});

/**
 * Reload ordering — TODO T14, whose trigger was "the Redis pub/sub
 * invalidation in T3".
 *
 * `reload()` reads every provider row and swaps the result in wholesale, so two
 * reloads running at once can finish in the opposite order to the one they
 * started in — leaving the registry describing an older database state than a
 * reload that already completed, and leaving it that way until something else
 * reloads.
 *
 * That was self-healing while reloads only followed local writes. §14.3 removes
 * the "only": a remote invalidation now arrives at a moment nothing chose, and
 * can land in the middle of a local reload.
 */
describe('reloads are serialised', () => {
  interface Deferred {
    resolve: (rows: unknown[]) => void;
    reject: (error: Error) => void;
  }

  function build() {
    const pending: Deferred[] = [];
    /** Every query issued and every snapshot applied, in the order they happened. */
    const timeline: string[] = [];

    const prisma = {
      provider: {
        findMany: vi.fn(() => {
          timeline.push('query');
          return new Promise<unknown[]>((resolve, reject) => {
            pending.push({ resolve, reject });
          });
        }),
      },
    };

    const loaded: string[][] = [];
    const registry = {
      load: vi.fn((rows: { slug: string }[]) => {
        timeline.push('load');
        loaded.push(rows.map((row) => row.slug));
      }),
    };

    const invalidations = { publish: vi.fn(async () => undefined), subscribe: vi.fn() };

    const service = new ProvidersService(
      prisma as never,
      registry as never,
      { register: vi.fn() } as never,
      invalidations as never,
    );

    return { service, prisma, registry, invalidations, pending, loaded, timeline };
  }

  const row = (slug: string) => ({ id: `id-${slug}`, slug, displayName: slug, isEnabled: true });
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it('does not start a second reload while the first is still reading', async () => {
    const { service, prisma, pending } = build();

    const first = service.reload();
    const second = service.reload();
    await settle();

    // The assertion that is the fix: the second query has not been issued.
    // Without chaining, both would be in flight and either could win.
    expect(prisma.provider.findMany).toHaveBeenCalledTimes(1);

    pending[0]!.resolve([row('alpha')]);
    await first;
    await settle();

    expect(prisma.provider.findMany).toHaveBeenCalledTimes(2);

    pending[1]!.resolve([row('beta')]);
    await second;
  });

  it('applies the first snapshot before it reads for the second', async () => {
    /*
     * The ordering, stated as the thing that actually prevents the bug: a
     * reload's query cannot begin until the previous reload's rows are already
     * in the registry. That makes "finished out of order" unreachable rather
     * than unlikely — there is never a moment with two snapshots in flight to
     * order wrongly.
     */
    const { service, pending, loaded, timeline } = build();

    const first = service.reload();
    const second = service.reload();
    await settle();

    pending[0]!.resolve([row('alpha')]);
    await first;
    await settle();

    pending[1]!.resolve([row('beta')]);
    await second;

    /*
     * Strictly alternating. Two reloads running concurrently produce
     * `query, query, load, load` — and once both queries are open, which
     * snapshot lands last is decided by the database, not by the caller.
     */
    expect(timeline).toEqual(['query', 'load', 'query', 'load']);
    expect(loaded).toEqual([['alpha'], ['beta']]);
  });

  it('keeps reloading after one fails', async () => {
    /*
     * A rejected reload must not poison the chain. If it did, a single
     * transient database error would freeze the registry for the life of the
     * process — and the symptom would be "every provider looks disabled",
     * hours later, with nothing pointing back at the error.
     */
    const { service, pending, loaded } = build();

    const failing = service.reload();
    await settle();
    pending[0]!.reject(new Error('connection lost'));
    await expect(failing).rejects.toThrow('connection lost');

    const next = service.reload();
    await settle();
    pending[1]!.resolve([row('gamma')]);
    await next;

    expect(loaded).toEqual([['gamma']]);
  });

  it('broadcasts only after its own reload has finished', async () => {
    /*
     * Order matters in the same direction as D51: telling other processes to
     * re-read before this one has finished reading is an invitation to a race
     * that this process cannot observe.
     */
    const { service, pending, invalidations } = build();

    const broadcast = service.reloadAndBroadcast();
    await settle();

    expect(invalidations.publish).not.toHaveBeenCalled();

    pending[0]!.resolve([row('alpha')]);
    await broadcast;

    expect(invalidations.publish).toHaveBeenCalledWith('providers', null);
  });

  it('does not broadcast a reload that failed', async () => {
    const { service, pending, invalidations } = build();

    const broadcast = service.reloadAndBroadcast();
    await settle();
    pending[0]!.reject(new Error('connection lost'));

    await expect(broadcast).rejects.toThrow('connection lost');
    expect(invalidations.publish).not.toHaveBeenCalled();
  });
});
