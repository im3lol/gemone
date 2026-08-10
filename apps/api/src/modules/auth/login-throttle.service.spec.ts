import { describe, expect, it, vi } from 'vitest';

import { DomainError, InfrastructureError } from '../../core/errors/app-error';
import {
  AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS,
  AUTH_LOGIN_IP_WINDOW_SECONDS,
  AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT,
  AUTH_LOGIN_MAX_FAILURES_PER_IP,
} from './auth.config';
import { LoginThrottleService } from './login-throttle.service';

/**
 * The throttle's mechanics, with an in-memory Redis.
 *
 * A fake rather than a real connection because what needs testing here is the
 * behaviour on the paths a real Redis will not produce on demand: the read
 * failing, the increment failing, and the exact boundary at which the ceiling
 * bites. All three are deterministic here and none of them are against a live
 * server.
 */

/** Only the commands the throttle uses, typed, so `multi` can call them back. */
interface FakeCommands {
  get: (key: string) => Promise<string | null>;
  incr: (key: string) => Promise<number>;
  decr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number, mode?: string) => Promise<number>;
  del: (key: string) => Promise<number>;
}

function fakeRedis(overrides: Partial<FakeCommands> = {}) {
  const store = new Map<string, number>();

  /** Present means "this key has a TTL"; the value is the window it was given. */
  const expiries = new Map<string, number>();

  const client: FakeCommands & { store: typeof store; expiries: typeof expiries } = {
    store,
    expiries,
    get: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : String(value);
    }),
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    /** Models Redis's own behaviour: a missing key decrements to -1. */
    decr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) - 1;
      store.set(key, next);
      return next;
    }),
    /**
     * Models `EXPIRE key seconds NX` — a TTL is set only on a key that has
     * none. Without this the fake would accept a service that re-arms the
     * window on every failure, which is the behaviour D73 forbids, and the
     * test asserting it would pass against broken code.
     */
    expire: vi.fn(async (key: string, seconds: number, mode?: string) => {
      if (mode === 'NX' && expiries.has(key)) return 0;
      expiries.set(key, seconds);
      return 1;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ...overrides,
  };

  /**
   * `MULTI`/`EXEC` over the same primitives, including any override — so a
   * test that makes `incr` fail still makes the transaction fail.
   *
   * Applied all-or-nothing: the state is snapshotted and restored if any
   * queued command throws. That is the property under test. A fake that
   * applied them one by one would let a half-executed transaction through and
   * report the blocker as fixed.
   */
  const multi = () => {
    const queued: Array<() => Promise<unknown>> = [];
    const touched = new Set<string>();

    const restorePoint = (map: Map<string, number>) =>
      [...touched].map((key) => [key, map.get(key)] as const);

    const rollback = (map: Map<string, number>, saved: ReadonlyArray<readonly [string, number | undefined]>) => {
      for (const [key, value] of saved) {
        if (value === undefined) map.delete(key);
        else map.set(key, value);
      }
    };

    const chain = {
      incr(key: string) {
        touched.add(key);
        queued.push(() => client.incr(key));
        return chain;
      },
      decr(key: string) {
        touched.add(key);
        queued.push(() => client.decr(key));
        return chain;
      },
      expire(key: string, seconds: number, mode?: string) {
        touched.add(key);
        queued.push(() => client.expire(key, seconds, mode));
        return chain;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        /*
         * Only the keys this transaction touches are rolled back. Snapshotting
         * the whole store would corrupt the *other* transaction running
         * concurrently — `reserveAttempt` bumps both counters at once — and the
         * resulting mess looks exactly like the bug under test.
         */
        const storeBefore = restorePoint(store);
        const expiriesBefore = restorePoint(expiries);

        try {
          const results: Array<[Error | null, unknown]> = [];
          for (const run of queued) results.push([null, await run()]);
          return results;
        } catch (error) {
          rollback(store, storeBefore);
          rollback(expiries, expiriesBefore);
          throw error;
        }
      },
    };
    return chain;
  };

  return { ...client, multi: vi.fn(multi) };
}

const LIMITS: Record<string, number> = {
  [AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key]: 3,
  [AUTH_LOGIN_MAX_FAILURES_PER_IP.key]: 5,
  [AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS.key]: 900,
  [AUTH_LOGIN_IP_WINDOW_SECONDS.key]: 1800,
};

function build(redis = fakeRedis()) {
  const configuration = { get: vi.fn(async (key: string) => LIMITS[key]) };
  const service = new LoginThrottleService(redis as never, configuration as never);
  return { service, redis, configuration };
}

const KEY = LoginThrottleService.accountKeyFor('someone@example.test');

describe('login throttling', () => {
  describe('the account bucket', () => {
    it('is the same for two spellings of one address', () => {
      /*
       * Normalized through the same function the lookup uses. Two spellings
       * landing in two buckets would mean the account ceiling is bypassed by
       * varying the capitalization — the counter would be per-spelling, and
       * there are unlimited spellings.
       */
      expect(LoginThrottleService.accountKeyFor('Someone@Example.test')).toBe(
        LoginThrottleService.accountKeyFor('someone@example.test'),
      );
    });

    it('does not contain the address it counts', () => {
      // A bounded, fixed-width token rather than an email sitting in plaintext
      // in a store that is not the database and has no retention policy.
      expect(KEY).not.toContain('someone');
      expect(KEY).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('ceilings', () => {
    it('refuses once the account reaches its limit', async () => {
      const { service } = build();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.reserveAttempt(KEY, '203.0.113.10');
      }

      await expect(service.reserveAttempt(KEY, '203.0.113.10')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    it('refuses once the address reaches its limit, across different accounts', async () => {
      /*
       * The case the account ceiling cannot see: a few attempts each against
       * many addresses, never tripping any single account.
       */
      const { service } = build();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const key = LoginThrottleService.accountKeyFor(`victim-${attempt}@example.test`);
        await service.reserveAttempt(key, '198.51.100.7');
      }

      const fresh = LoginThrottleService.accountKeyFor('never-tried@example.test');
      await expect(service.reserveAttempt(fresh, '198.51.100.7')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    it('answers one code for both ceilings', async () => {
      // Saying which ceiling was hit would reveal whether the address is one
      // the system has a counter for.
      const { service } = build();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.reserveAttempt(KEY, null);
      }

      await service.reserveAttempt(KEY, null).catch((error: DomainError) => {
        expect(error.code).toBe('RATE_LIMITED');
        expect(error.httpStatus).toBe(429);
      });
      expect.assertions(2);
    });
  });

  describe('a missing address', () => {
    it('skips the IP bucket entirely rather than sharing one', async () => {
      /*
       * Grouping every unidentified caller into a shared bucket would let one
       * of them lock out all the others.
       */
      const { service, redis } = build();

      await service.reserveAttempt(KEY, null);

      const ipKeys = [...redis.store.keys()].filter((key) => key.includes(':ip:'));
      expect(ipKeys).toEqual([]);
    });

    it('still enforces the account ceiling', async () => {
      const { service } = build();

      for (let attempt = 0; attempt < 3; attempt += 1) await service.reserveAttempt(KEY, null);

      await expect(service.reserveAttempt(KEY, null)).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('what a correct password clears', () => {
    it('clears the account bucket', async () => {
      const { service } = build();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.reserveAttempt(KEY, '203.0.113.10');
      }
      await service.releaseAttempt(KEY, '203.0.113.10');

      await expect(service.reserveAttempt(KEY, null)).resolves.toBeUndefined();
    });

    it('gives back only this attempt’s own place in the IP bucket', async () => {
      /*
       * D73, and the reason the whole IP ceiling is worth having. If a success
       * cleared it, the limit falls to: fail four times, log into an account
       * you own, repeat forever.
       *
       * Every attempt now reserves a place, including the successful one, so
       * "the IP bucket survives" has to mean something more exact than before:
       * the count left behind is the count that was there *before this
       * attempt*. Not zero, and not one too many either.
       */
      const { service, redis } = build();
      const ip = '198.51.100.7';

      // Four failures, one each against four addresses, so no account ceiling
      // is involved — the shape only the IP counter can see.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const key = LoginThrottleService.accountKeyFor(`victim-${attempt}@example.test`);
        await service.reserveAttempt(key, ip);
      }

      // A genuine login from the same address, in the middle of that.
      const mine = LoginThrottleService.accountKeyFor('mine@example.test');
      await service.reserveAttempt(mine, ip);
      await service.releaseAttempt(mine, ip);

      const ipKey = [...redis.store.keys()].find((key) => key.includes(':ip:'));
      expect(redis.store.get(ipKey!)).toBe(4);

      // And the ceiling of five still arrives when it should: one more failure
      // reaches it, the one after that is refused.
      await service.reserveAttempt(
        LoginThrottleService.accountKeyFor('victim-4@example.test'),
        ip,
      );
      await expect(
        service.reserveAttempt(LoginThrottleService.accountKeyFor('victim-5@example.test'), ip),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('when Redis is unavailable', () => {
    it('refuses authentication rather than allowing it — §15.4 fails closed', async () => {
      const redis = fakeRedis({
        incr: vi.fn(async () => {
          throw new Error('Connection is closed.');
        }),
      });
      const { service } = build(redis);

      await expect(service.reserveAttempt(KEY, '203.0.113.10')).rejects.toBeInstanceOf(
        InfrastructureError,
      );
    });

    it('answers 503, not 429 — the caller is not throttled, the control is down', async () => {
      const redis = fakeRedis({
        incr: vi.fn(async () => {
          throw new Error('Connection is closed.');
        }),
      });
      const { service } = build(redis);

      await service.reserveAttempt(KEY, null).catch((error: InfrastructureError) => {
        expect(error.httpStatus).toBe(503);
      });
      expect.assertions(1);
    });

    it('refuses rather than admitting an attempt it could not count', async () => {
      /*
       * The increment is no longer bookkeeping that happens after the verdict;
       * it *is* the check. An attempt that could not take its place in the
       * counter is an attempt nothing is bounding, so it is refused — §15.4,
       * the same reason the whole control fails closed.
       */
      const redis = fakeRedis({
        incr: vi.fn(async () => {
          throw new Error('Connection is closed.');
        }),
      });
      const { service } = build(redis);

      await expect(service.reserveAttempt(KEY, '203.0.113.10')).rejects.toBeInstanceOf(
        InfrastructureError,
      );
    });

    it('swallows a failure to release, so a successful login stays successful', async () => {
      const redis = fakeRedis({
        del: vi.fn(async () => {
          throw new Error('Connection is closed.');
        }),
      });
      const { service } = build(redis);

      await expect(service.releaseAttempt(KEY, '203.0.113.10')).resolves.toBeUndefined();
    });
  });

  describe('the window', () => {
    const accountKeyIn = (redis: ReturnType<typeof fakeRedis>) =>
      [...redis.expiries.keys()].find((key) => key.includes(':account:'));

    it('is set when the bucket is created', async () => {
      const { service, redis } = build();

      await service.reserveAttempt(KEY, null);

      expect(redis.expiries.get(accountKeyIn(redis)!)).toBe(
        LIMITS[AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS.key],
      );
    });

    it('is never extended once it exists', async () => {
      /*
       * A fixed window, not one that restarts on every failure. Re-setting the
       * expiry per attempt would let an attacker hold a victim locked out
       * indefinitely simply by continuing to fail — the lockout would never age
       * out while the attack continued.
       *
       * Asserted on the expiry the key actually carries rather than on how many
       * times `expire` was called: the command now runs on every increment and
       * declines to act, which is a different implementation of the same rule.
       * Counting calls would fail correct code and pass code that re-armed the
       * window through some other command.
       */
      const { service, redis } = build();

      await service.reserveAttempt(KEY, null);

      // Stand in for a window part-way through: a real TTL counts down, this
      // one is a number, so shortening it is how "time passed" is expressed.
      redis.expiries.set(accountKeyIn(redis)!, 42);

      await service.reserveAttempt(KEY, null);
      await service.reserveAttempt(KEY, null);

      expect(redis.expiries.get(accountKeyIn(redis)!)).toBe(42);
    });

    it('gives each bucket the window configured for it', async () => {
      const { service, redis } = build();

      await service.reserveAttempt(KEY, '203.0.113.10');

      const ipKey = [...redis.expiries.keys()].find((key) => key.includes(':ip:'));
      expect(redis.expiries.get(accountKeyIn(redis)!)).toBe(
        LIMITS[AUTH_LOGIN_ACCOUNT_WINDOW_SECONDS.key],
      );
      expect(redis.expiries.get(ipKey!)).toBe(LIMITS[AUTH_LOGIN_IP_WINDOW_SECONDS.key]);
    });

    it('never leaves a counter standing without one', async () => {
      /*
       * The blocker this transaction exists for.
       *
       * The previous form issued `INCR` and then, only when the counter came
       * back as 1, `EXPIRE`. Redis going away between the two left a counter
       * with no expiry that no later attempt would ever repair, because the
       * count was no longer 1 — a window that silently became infinite and a
       * lockout that never aged out.
       *
       * Asserted as an invariant over the whole store rather than as a
       * sequence of calls: *no counted key exists without an expiry*, whatever
       * failed. Rewriting the reservation as two separate commands fails this,
       * because the increment lands and the expiry does not.
       */
      const redis = fakeRedis({
        expire: vi.fn(async () => {
          throw new Error('Connection is closed.');
        }),
      });
      const { service } = build(redis);

      // The attempt is refused — an increment that could not be given an
      // expiry is one the control cannot bound. What matters here is what it
      // left behind.
      await expect(service.reserveAttempt(KEY, '203.0.113.10')).rejects.toBeInstanceOf(
        InfrastructureError,
      );

      for (const key of redis.store.keys()) {
        expect(redis.expiries.has(key)).toBe(true);
      }
      expect(redis.store.size).toBe(0);
    });

    it('reads its thresholds from configuration, never from a literal', async () => {
      const { service, configuration } = build();

      await service.reserveAttempt(KEY, '203.0.113.10');

      expect(configuration.get).toHaveBeenCalledWith(AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key);
      expect(configuration.get).toHaveBeenCalledWith(AUTH_LOGIN_MAX_FAILURES_PER_IP.key);
    });
  });
});
