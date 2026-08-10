import { describe, expect, it, vi } from 'vitest';

import { DomainError, InfrastructureError } from '../../core/errors/app-error';
import { AUTH_PUBLIC_MAX_REQUESTS_PER_IP } from './auth.config';
import { PublicThrottleService } from './public-throttle.service';

/**
 * The counter's mechanics, against an in-memory Redis.
 *
 * A fake for the same reason the login throttle uses one: the paths worth
 * testing are the ones a live server will not produce on demand — the
 * transaction failing, and the exact request at which the ceiling bites.
 */
function fakeRedis(overrides: { incr?: (key: string) => Promise<number> } = {}) {
  const store = new Map<string, number>();

  /** Present means the key has a TTL; the value is the window it was given. */
  const expiries = new Map<string, number>();

  const incr =
    overrides.incr ??
    (async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    });

  /**
   * Models `EXPIRE key seconds NX` — a TTL is set only on a key without one.
   * A fake that re-armed the window on every request would accept a service
   * that lets one address hold a bucket full indefinitely.
   */
  const expire = async (key: string, seconds: number, mode?: string) => {
    if (mode === 'NX' && expiries.has(key)) return 0;
    expiries.set(key, seconds);
    return 1;
  };

  const multi = () => {
    const queued: Array<() => Promise<unknown>> = [];

    const chain = {
      incr(key: string) {
        queued.push(() => incr(key));
        return chain;
      },
      expire(key: string, seconds: number, mode?: string) {
        queued.push(() => expire(key, seconds, mode));
        return chain;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        const results: Array<[Error | null, unknown]> = [];
        for (const run of queued) results.push([null, await run()]);
        return results;
      },
    };

    return chain;
  };

  return { store, expiries, multi: vi.fn(multi) };
}

const LIMIT = 3;

function build(redis = fakeRedis()) {
  const configuration = {
    get: vi.fn(async (key: string) =>
      key === AUTH_PUBLIC_MAX_REQUESTS_PER_IP.key ? LIMIT : 300,
    ),
  };

  const service = new PublicThrottleService(redis as never, configuration as never);
  return { service, redis, configuration };
}

describe('public endpoint throttling', () => {
  it('admits exactly the configured number of requests', async () => {
    const { service } = build();

    for (let i = 0; i < LIMIT; i++) {
      await expect(service.reserve('register', '203.0.113.5')).resolves.toBeUndefined();
    }

    await expect(service.reserve('register', '203.0.113.5')).rejects.toBeInstanceOf(DomainError);
  });

  it('answers 429 without naming the endpoint or the limit', async () => {
    /*
     * On `forgot-password` any difference in the answer is something an
     * enumerator can read, and a message carrying the remaining allowance
     * tells an attacker exactly how to pace the next attempt.
     */
    const { service } = build();
    for (let i = 0; i < LIMIT; i++) await service.reserve('forgotPassword', '203.0.113.5');

    const error = await service.reserve('forgotPassword', '203.0.113.5').then(
      () => null,
      (caught: unknown) => caught as DomainError,
    );

    expect(error).toBeInstanceOf(DomainError);
    if (error === null) throw new Error('unreachable');

    expect(error.httpStatus).toBe(429);
    expect(error.message).toBe('Too many requests. Please wait before trying again.');
    expect(error.message).not.toMatch(/forgot|password|3|register/i);
  });

  it('counts each endpoint separately', async () => {
    // Registering must not consume the allowance for refreshing a session:
    // one exhausted bucket would otherwise lock a user out of the others.
    const { service } = build();
    for (let i = 0; i < LIMIT; i++) await service.reserve('register', '203.0.113.5');

    await expect(service.reserve('refresh', '203.0.113.5')).resolves.toBeUndefined();
  });

  it('counts each address separately', async () => {
    const { service } = build();
    for (let i = 0; i < LIMIT; i++) await service.reserve('register', '203.0.113.5');

    await expect(service.reserve('register', '198.51.100.9')).resolves.toBeUndefined();
  });

  it('holds under a burst, because the counter is taken before the verdict', async () => {
    /*
     * The failure this shape exists to avoid, measured on the login throttle:
     * reading the counter and incrementing after the verdict let all ten of ten
     * concurrent attempts through a ceiling of five, because every one of them
     * read the same number. `INCR` hands each caller a distinct value, so
     * exactly `limit` of them are within the ceiling however they interleave.
     */
    const { service } = build();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.reserve('forgotPassword', '203.0.113.5')),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(LIMIT);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(10 - LIMIT);
  });

  it('sets the window once and never re-arms it', async () => {
    // A window re-armed on every request never ages out, so an address that
    // keeps calling holds its own bucket full forever — and, on an IP counter,
    // holds everyone behind that address out with it.
    const { service, redis } = build();

    await service.reserve('register', '203.0.113.5');
    await service.reserve('register', '203.0.113.5');

    expect([...redis.expiries.values()]).toEqual([300]);
    expect(redis.expiries.size).toBe(1);
  });

  it('does not count a caller with no address', async () => {
    // Every anonymous caller would share one bucket, and one of them could
    // then lock out all the others.
    const { service, redis } = build();

    for (let i = 0; i < LIMIT + 5; i++) {
      await expect(service.reserve('register', null)).resolves.toBeUndefined();
    }

    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('fails closed when the counter is unusable', async () => {
    /*
     * §15.4, and the same choice the login throttle makes: an unavailable
     * control is not a reason to stop controlling. The cost — a Redis outage
     * refuses these endpoints — is the one T60 already records.
     */
    const { service } = build(
      fakeRedis({
        incr: async () => {
          throw new Error('connection refused');
        },
      }),
    );

    await expect(service.reserve('register', '203.0.113.5')).rejects.toBeInstanceOf(
      InfrastructureError,
    );
  });

  it('never keys on anything but the endpoint and the address', async () => {
    /*
     * The property that keeps this from becoming an enumeration oracle: there
     * is no account key in this control, so a registered address and an
     * unregistered one produce identical counters. Asserted on the key itself
     * because "we did not add one" is only true until someone does.
     */
    const { service, redis } = build();

    await service.reserve('forgotPassword', '203.0.113.5');

    expect([...redis.store.keys()]).toEqual(['ow:1:public-throttle:forgotPassword:203.0.113.5']);
  });
});
