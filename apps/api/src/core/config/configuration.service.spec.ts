import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ConfigurationService } from './configuration.service';
import type { ConfigurationKeyDefinition } from './configuration-key';

/**
 * A read in flight must never repopulate the cache — D65.
 *
 * ## Why these are unit tests and not integration tests
 *
 * The window being closed is the duration of one database query, and the
 * interleaving that matters is "the invalidation lands after the query is
 * issued and before its result is stored". An integration test cannot place an
 * event inside that window on purpose; it can only run the same code many times
 * and hope. A test that reproduces a race by luck is a test that stops
 * reproducing it the moment the machine gets faster.
 *
 * So the query is a promise this file resolves by hand. Every ordering below is
 * exact, and every one of them fails if the generation check is removed.
 */

const KEY: ConfigurationKeyDefinition<number> = {
  key: 'probe.value',
  schema: z.number(),
  defaultValue: 1,
  description: 'A numeric key, for ordering tests',
  scopes: ['GLOBAL'],
  valueType: 'number',
};

const OTHER: ConfigurationKeyDefinition<number> = {
  ...KEY,
  key: 'probe.other',
};

interface Harness {
  service: ConfigurationService;
  /** Resolves the Nth outstanding query with a stored value, or null for no row. */
  settle: (index: number, value: number | null) => void;
  queries: () => number;
}

function harness(): Harness {
  const pending: ((row: unknown) => void)[] = [];

  const prisma = {
    configurationValue: {
      findUnique: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            pending.push(resolve);
          }),
      ),
    },
  };

  const service = new ConfigurationService(
    prisma as never,
    { now: () => new Date(0) } as never,
    { subscribe: vi.fn(), publish: vi.fn(async () => undefined) } as never,
  );

  service.register(KEY);
  service.register(OTHER);

  return {
    service,
    settle: (index, value) => pending[index]?.(value === null ? null : { value }),
    queries: () => prisma.configurationValue.findUnique.mock.calls.length,
  };
}

/** Lets an already-resolved query's continuation run. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('a read that is overtaken by an invalidation', () => {
  it('does not cache what it read', async () => {
    /*
     * The exact sequence that produced a permanently stale value:
     *
     *   1. a read misses and issues its query
     *   2. a write commits elsewhere; the invalidation arrives and deletes an
     *      entry that has not been written yet
     *   3. the query resolves with the pre-write row
     *   4. the read stores it — and nothing further is coming to correct it
     */
    const { service, settle } = harness();

    const inFlight = service.get<number>(KEY.key);
    await tick();

    service.invalidate(KEY.key, 'GLOBAL', '');

    settle(0, 7);
    expect(await inFlight).toBe(7);

    // The next read must go back to the database rather than being served the
    // value the invalidation was about.
    const next = service.get<number>(KEY.key);
    await tick();
    settle(1, 99);

    expect(await next).toBe(99);
  });

  it('still returns what it read, because that is not staleness', async () => {
    /*
     * External behaviour is unchanged. A read that began before a write
     * legitimately observes what was there when it began — that is ordinary
     * read timing, and turning it into a retry would change the contract for a
     * problem that is only about persistence.
     */
    const { service, settle } = harness();

    const inFlight = service.get<number>(KEY.key);
    await tick();
    service.invalidate(KEY.key, 'GLOBAL', '');
    settle(0, 7);

    await expect(inFlight).resolves.toBe(7);
  });

  it('does not cache a miss either', async () => {
    /*
     * The sentinel is as dangerous as a value. A miss cached after the row it
     * was looking for has just been created makes the key resolve to its
     * default for the life of the process — the same failure wearing a
     * different mask.
     */
    const { service, settle } = harness();

    const inFlight = service.get<number>(KEY.key);
    await tick();

    service.invalidate(KEY.key, 'GLOBAL', '');
    settle(0, null);
    expect(await inFlight).toBe(KEY.defaultValue);

    const next = service.get<number>(KEY.key);
    await tick();
    settle(1, 42);

    expect(await next).toBe(42);
  });

  it('does not cache a value the schema rejected', async () => {
    /*
     * The invalid-value path also caches a sentinel (D55), so it needs the same
     * guard. Without it, a row repaired at the moment it was being read stays
     * "invalid" in this process forever.
     */
    const { service, settle } = harness();

    const inFlight = service.get<number>(KEY.key);
    await tick();

    service.invalidate(KEY.key, 'GLOBAL', '');
    settle(0, 'not a number' as unknown as number);
    expect(await inFlight).toBe(KEY.defaultValue);

    const next = service.get<number>(KEY.key);
    await tick();
    settle(1, 42);

    expect(await next).toBe(42);
  });

  it('is closed by invalidateAll as well as by invalidate', async () => {
    /*
     * `invalidateAll` is what a resync calls (D60, D61, D64), and a resync is
     * when this race is *most* likely: dropping every entry at once leaves
     * every key's next read a query, so there are more reads in flight then
     * than at any other moment.
     */
    const { service, settle } = harness();

    const inFlight = service.get<number>(KEY.key);
    await tick();

    service.invalidateAll();
    settle(0, 7);
    await inFlight;

    const next = service.get<number>(KEY.key);
    await tick();
    settle(1, 99);

    expect(await next).toBe(99);
  });

  it('discards the write-back of reads for other keys too', async () => {
    /*
     * The generation is global, so an invalidation of one key also stops an
     * unrelated read from caching. Asserted rather than left implicit: it is a
     * deliberate coarseness (D65, T53), it is conservative in the safe
     * direction, and its whole cost is one extra query.
     */
    const { service, settle, queries } = harness();

    const other = service.get<number>(OTHER.key);
    await tick();

    service.invalidate(KEY.key, 'GLOBAL', '');
    settle(0, 5);
    expect(await other).toBe(5);

    const next = service.get<number>(OTHER.key);
    await tick();
    settle(1, 5);
    expect(await next).toBe(5);

    /*
     * The assertion has to be the query, not the value: the value is 5 whether
     * or not the write-back was discarded. Two queries means the unrelated
     * read declined to cache — which is the coarseness, made visible.
     */
    expect(queries()).toBe(2);
  });
});

describe('a read that is not overtaken', () => {
  it('still caches, so one query serves every later read', async () => {
    /*
     * The anti-regression that matters most. A "fix" that simply stopped
     * caching would pass every test above and quietly turn a cache read on
     * nearly every business operation (§14.3) into a database round trip.
     */
    const { service, settle, queries } = harness();

    const first = service.get<number>(KEY.key);
    await tick();
    settle(0, 7);
    expect(await first).toBe(7);

    expect(await service.get<number>(KEY.key)).toBe(7);
    expect(await service.get<number>(KEY.key)).toBe(7);

    expect(queries()).toBe(1);
  });

  it('caches a miss, so an unset key does not query on every read', async () => {
    const { service, settle, queries } = harness();

    const first = service.get<number>(KEY.key);
    await tick();
    settle(0, null);
    expect(await first).toBe(KEY.defaultValue);

    expect(await service.get<number>(KEY.key)).toBe(KEY.defaultValue);

    expect(queries()).toBe(1);
  });

  it('caches when the invalidation lands before the read starts', async () => {
    /*
     * The boundary in the other direction: an invalidation that has already
     * finished must not poison reads that begin after it. If it did, the cache
     * would be permanently disabled by the first write of the process's life.
     */
    const { service, settle, queries } = harness();

    service.invalidate(KEY.key, 'GLOBAL', '');

    const first = service.get<number>(KEY.key);
    await tick();
    settle(0, 7);
    await first;

    expect(await service.get<number>(KEY.key)).toBe(7);
    expect(queries()).toBe(1);
  });
});
