import { describe, expect, it } from 'vitest';

import { __testing } from './catalog-sync.processor';

const { minuteBucket, buildSyncJobId } = __testing;

describe('buildSyncJobId', () => {
  it('contains no colon', () => {
    /*
     * BullMQ composes its Redis keys as `bull:<queue>:<id>` and rejects a
     * custom id containing a colon. It rejects it by *throwing inside the
     * tick*, so the failure mode is not a duplicate job — it is no scheduled
     * sync ever running, with an exception in a log nobody is reading yet.
     */
    const id = buildSyncJobId('0192f0a0-0000-7000-8000-0000000000aa', 'FULL', new Date(0));

    expect(id).not.toContain(':');
    expect(id).toBe('catalog-sync_0192f0a0-0000-7000-8000-0000000000aa_FULL_0');
  });

  it('is stable for the same work in the same window', () => {
    const at = new Date('2026-08-02T10:15:00Z');

    expect(buildSyncJobId('p', 'FULL', at)).toBe(buildSyncJobId('p', 'FULL', at));
  });

  it('separates providers, modes and windows', () => {
    const at = new Date('2026-08-02T10:15:00Z');
    const later = new Date('2026-08-02T10:16:00Z');

    expect(buildSyncJobId('p1', 'FULL', at)).not.toBe(buildSyncJobId('p2', 'FULL', at));
    expect(buildSyncJobId('p1', 'FULL', at)).not.toBe(buildSyncJobId('p1', 'INCREMENTAL', at));
    expect(buildSyncJobId('p1', 'FULL', at)).not.toBe(buildSyncJobId('p1', 'FULL', later));
  });
});

/**
 * The job-id key, which is what makes a repeated enqueue harmless.
 *
 * §13.2 asks for an explicit `jobId` derived from the work's natural key so
 * that enqueueing the same work twice is a no-op. The subtlety worth a test is
 * the *window*: without one the id would be identical forever, and the second
 * legitimate sync an hour later would be silently discarded as a duplicate —
 * a scheduled job that stops running and reports nothing wrong.
 */
describe('minuteBucket', () => {
  it('is stable within a minute', () => {
    expect(minuteBucket(new Date('2026-08-02T10:15:00Z'))).toBe(
      minuteBucket(new Date('2026-08-02T10:15:59Z')),
    );
  });

  it('changes at the minute boundary', () => {
    expect(minuteBucket(new Date('2026-08-02T10:15:59Z'))).not.toBe(
      minuteBucket(new Date('2026-08-02T10:16:00Z'))
    );
  });

  it('advances monotonically, so an id is never reused later', () => {
    const earlier = minuteBucket(new Date('2026-08-02T10:15:00Z'));
    const later = minuteBucket(new Date('2026-08-02T11:15:00Z'));

    expect(later).toBeGreaterThan(earlier);
    expect(later - earlier).toBe(60);
  });
});
