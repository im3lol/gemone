import { Redis } from 'ioredis';
import { afterAll, beforeEach } from 'vitest';

import { loadDotenvForDevelopment } from '../../src/core/config/load-dotenv';

/**
 * Integration test setup.
 *
 * Loads `apps/api/.env` exactly as the entrypoints do, so running the suite
 * locally needs no shell ceremony — the same file that configures the Prisma
 * CLI and `nest start` configures the tests.
 *
 * Reuses the application's own helper rather than reimplementing env loading,
 * so the tests cannot drift from how the process actually boots.
 *
 * CI sets DATABASE_URL directly and ships no `.env`; real environment
 * variables take precedence, so both paths work without a branch.
 */
loadDotenvForDevelopment();

/**
 * The mock provider's credentials.
 *
 * Defaulted rather than required, because CI ships no `.env` and these
 * authenticate nothing — the mock talks to no network. A real deployment sets
 * every `PROVIDER_*` variable itself, and the registry makes a provider inert
 * with a named-variable error when it does not, which the unit tests cover
 * directly.
 *
 * The provider fixtures are assigned unconditionally, because tests assert on
 * the values the adapter builds from them. They were `??=`, which meant a
 * developer who had copied `.env.example` — where `PROVIDER_MOCK_AFFILIATE_ID`
 * is `AFF-DEV` — failed three tests that assert `AFF-TEST`, on an untracked
 * file, with nothing in the failure naming the cause.
 *
 * `CLICK_SIGNING_SECRET` keeps `??=`: nothing asserts on the signature's value,
 * only that it verifies, so a developer's own secret is harmless there.
 */
process.env.CLICK_SIGNING_SECRET ??= 'integration-test-click-signing-secret-x';
process.env.PROVIDER_MOCK_SECRET = 'mock-fixture-secret';
process.env.PROVIDER_MOCK_AFFILIATE_ID = 'AFF-TEST';

/**
 * The public-endpoint request counters, cleared between tests.
 *
 * `PublicThrottleService` counts requests per address per endpoint, and **every
 * test in this suite arrives from `127.0.0.1`** — so a file that registers
 * thirty users spends one address's whole allowance and the thirty-first test
 * fails with a 429 that has nothing to do with what it was checking. In
 * production each caller brings their own address; here they all share one, and
 * that is a property of the harness rather than of the control.
 *
 * Here rather than in each spec because it is not any one spec's concern: a
 * test that registers a user is not asking to be throttled, and the file that
 * *is* about throttling sets its own limits and clears its own keys anyway.
 *
 * Only this prefix. The login throttle's counters belong to the tests that
 * exercise them.
 */
const throttleRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

beforeEach(async () => {
  const keys = await throttleRedis.keys('ow:1:public-throttle:*');
  if (keys.length > 0) await throttleRedis.del(...keys);
});

afterAll(() => {
  throttleRedis.disconnect();
});
