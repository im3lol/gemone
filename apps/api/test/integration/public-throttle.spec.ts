import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@gemone/contracts';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import {
  AUTH_PUBLIC_IP_WINDOW_SECONDS,
  AUTH_PUBLIC_MAX_REQUESTS_PER_IP,
} from '../../src/modules/auth/auth.config';
import { LOGIN_THROTTLE_REDIS } from '../../src/modules/auth/auth.tokens';

/**
 * The public auth endpoints under load — ARCHITECTURE.md §19.5.
 *
 * The unit tests cover the counter. What only a real request shows is that the
 * ceiling is actually *attached* to the endpoints that were unbounded, that a
 * second address is unaffected, and — the property that matters most here —
 * that throttling `forgot-password` did not turn it into the enumeration oracle
 * the 204 exists to prevent.
 */
describe('public endpoint throttling (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configuration: ConfigurationService;
  let redis: Redis;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `public-throttle-${++counter}.${Date.now()}@example.com`;

  const LIMIT = 3;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    configuration = app.get(ConfigurationService);
    redis = app.get(LOGIN_THROTTLE_REDIS);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    /*
     * One proxy in front, so `X-Forwarded-For` is honoured and each test can
     * present a distinct address. Off by default (`clicks-http.spec.ts` sets it
     * the same way), because trusting the header with nothing in front lets a
     * caller choose their own bucket.
     */
    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    /*
     * Deleted inwards-out along the foreign keys — the same chain
     * `login-throttle.spec.ts` uses and for the reason it records: registration
     * opens a balance row, so a shorter chain is green in isolation and fails
     * on `user_balances_user_id_fkey` the moment anything registers.
     */
    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    configuration.invalidateAll();

    // Counters live in Redis, which the database cleanup above does not touch:
    // a leftover count would throttle the next test for reasons nothing in
    // this file explains.
    const keys = await redis.keys('ow:1:public-throttle:*');
    if (keys.length > 0) await redis.del(...keys);

    await configuration.set(AUTH_PUBLIC_MAX_REQUESTS_PER_IP.key, LIMIT, {
      actor: { type: 'system' },
    });
    await configuration.set(AUTH_PUBLIC_IP_WINDOW_SECONDS.key, 300, {
      actor: { type: 'system' },
    });
  });

  const forgotPassword = (email: string, ip: string) =>
    request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email });

  it('admits requests below the ceiling and refuses the one past it', async () => {
    const ip = '203.0.113.10';

    for (let i = 0; i < LIMIT; i++) {
      await forgotPassword(nextEmail(), ip).expect(204);
    }

    const refused = await forgotPassword(nextEmail(), ip).expect(429);
    expect(refused.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('isolates one address from another', async () => {
    // A shared bucket would let one abusive address lock out everyone else.
    for (let i = 0; i < LIMIT + 1; i++) await forgotPassword(nextEmail(), '203.0.113.11');

    await forgotPassword(nextEmail(), '198.51.100.4').expect(204);
  });

  it('counts each endpoint separately', async () => {
    const ip = '203.0.113.12';
    for (let i = 0; i < LIMIT + 1; i++) await forgotPassword(nextEmail(), ip);

    // Exhausting the reset bucket must not close registration for that address.
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email: nextEmail(), password })
      .expect(201);
  });

  it('bounds a burst instead of admitting all of it', async () => {
    /*
     * The concurrency shape the login throttle was already fixed for: reading
     * the counter and incrementing after the verdict lets every request inside
     * the gap read the same number, and a ceiling of three admitted all ten.
     *
     * ## Why this counts admissions rather than asserting ten exact statuses
     *
     * Ten simultaneous supertest connections that end in 429 lose some of
     * themselves to `ECONNRESET` in this harness. That is not this control: the
     * same burst against `/auth/login`, throttled by the pre-existing
     * `LoginThrottleService`, resets exactly the same way. A reset is a request
     * that got no answer, so counting the ones that were *admitted* is both the
     * property under test and the only reading the harness reports reliably —
     * a broken counter shows up here as ten admissions, not as three.
     */
    const ip = '203.0.113.13';

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => forgotPassword(nextEmail(), ip)),
    );

    const answered = settled
      .filter((outcome) => outcome.status === 'fulfilled')
      .map((outcome) => outcome.value);

    const admitted = answered.filter((response) => response.status === 204);

    expect(admitted.length).toBeLessThanOrEqual(LIMIT);
    // And the burst really was processed — not all ten lost to the harness.
    expect(answered.some((response) => response.status === 429)).toBe(true);
  });

  it('throttles a registered address exactly as it throttles an unknown one', async () => {
    /*
     * The enumeration property, restated for this control.
     *
     * `forgot-password` answers 204 whatever happens so that a registered
     * address and an unregistered one are indistinguishable. A throttle keyed
     * on the *account* would have re-opened that question — the counter would
     * only ever fill for addresses that exist — so this one is keyed on the
     * address of the caller and nothing else. Both sequences below must be
     * identical, response for response.
     */
    const registered = nextEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ email: registered, password })
      .expect(201);

    const known = [];
    for (let i = 0; i < LIMIT + 1; i++) known.push(await forgotPassword(registered, '203.0.113.21'));

    const unknown = [];
    const missing = nextEmail();
    for (let i = 0; i < LIMIT + 1; i++) unknown.push(await forgotPassword(missing, '203.0.113.22'));

    expect(known.map((response) => response.status)).toEqual(
      unknown.map((response) => response.status),
    );
    // Minus the correlation id, which is per-request by design and carries
    // nothing about the address that was asked for.
    const shape = (body: { error?: { code: string; message: string } }) =>
      body.error ? { code: body.error.code, message: body.error.message } : body;

    expect(known.map((response) => shape(response.body))).toEqual(
      unknown.map((response) => shape(response.body)),
    );
  });

  it('does not put a per-IP ceiling on refresh', async () => {
    /*
     * `refresh` is called by `web`, never by a browser (§6.1), so every request
     * carries one address: the BFF's. A per-IP request ceiling here would be a
     * ceiling on the entire platform — everyone signed out at once, and unable
     * to sign back in — which is why this endpoint is deliberately outside this
     * control. What bounds it is the token itself (§8.2).
     *
     * Asserted with more attempts than the ceiling, so re-decorating the
     * handler fails here rather than in production.
     */
    const email = nextEmail();
    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', '203.0.113.40')
      .send({ email, password })
      .expect(201);

    const cookie = registration.headers['set-cookie'] as unknown as string[];

    for (let i = 0; i < LIMIT + 3; i++) {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('X-Forwarded-For', '203.0.113.41')
        .set('Cookie', cookie)
        .send({});

      // Rotation means each attempt after the first replays a spent token, so
      // 401 is expected — what must never appear here is 429.
      expect(response.status).not.toBe(429);
    }
  });

  it('leaves login to its own control', async () => {
    /*
     * `login` counts failures and releases them on success; this counts
     * requests. Stacking both on one endpoint would change which one fires
     * without making anything safer, so login is deliberately not decorated —
     * asserted here so removing that decision is a failing test rather than a
     * quiet change in behaviour.
     */
    const email = nextEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Forwarded-For', '203.0.113.30')
      .send({ email, password })
      .expect(201);

    for (let i = 0; i < LIMIT + 2; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.31')
        .send({ email, password })
        .expect(200);
    }
  });
});
