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
  AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT,
  AUTH_LOGIN_MAX_FAILURES_PER_IP,
} from '../../src/modules/auth/auth.config';
import { LOGIN_THROTTLE_REDIS } from '../../src/modules/auth/auth.tokens';

/**
 * Login throttling over HTTP — ARCHITECTURE.md §8.3, closing TODO T2.
 *
 * The unit tests cover the counter mechanics against a fake Redis. What only a
 * real request can show is the property the whole flow is arranged around: that
 * a registered address and an unregistered one are still indistinguishable
 * *after* throttling exists. A lockout that only ever happens to real accounts
 * is an enumeration oracle wearing a security control's clothes.
 */
describe('login throttling (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configuration: ConfigurationService;
  let redis: Redis;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `throttle-${++counter}.${Date.now()}@example.com`;

  const ACCOUNT_LIMIT = 3;
  const IP_LIMIT = 6;

  /** Simultaneous attempts in the two concurrency tests — see the note there. */
  const BURST = 10;

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
     * Deleted inwards-out, along the foreign keys — the same chain
     * `auth.spec.ts` uses and for the same reason it records there: getting it
     * wrong fails only when a *previous file* left rows behind. This file
     * shipped deleting three tables, which was green in isolation and green in
     * most whole-suite runs; running it after `fraud.spec.ts` fails every test
     * in it on `clicks_user_id_fkey`.
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

    /*
     * Every counter, every run. They live in Redis rather than in a table the
     * database cleanup above would truncate, so a leftover count from the
     * previous test would throttle the next one for reasons nothing in the
     * file explains.
     */
    const keys = await redis.keys('ow:1:login-throttle:*');
    if (keys.length > 0) await redis.del(...keys);

    // Set through the configuration service rather than by constant, which is
    // also what proves the thresholds are P3 values and not literals.
    await configuration.set(AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key, ACCOUNT_LIMIT, {
      actor: { type: 'system' },
    });
    await configuration.set(AUTH_LOGIN_MAX_FAILURES_PER_IP.key, IP_LIMIT, {
      actor: { type: 'system' },
    });
  });

  const server = () => app.getHttpServer();

  async function register(email: string) {
    await request(server()).post('/auth/register').send({ email, password }).expect(201);
  }

  const attempt = (email: string, withPassword = 'wrong-password-entirely') =>
    request(server()).post('/auth/login').send({ email, password: withPassword });

  it('refuses an account once its ceiling is reached', async () => {
    const email = nextEmail();
    await register(email);

    for (let index = 0; index < ACCOUNT_LIMIT; index += 1) {
      await attempt(email).expect(401);
    }

    const blocked = await attempt(email).expect(429);
    expect(blocked.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('holds the account ceiling when the attempts arrive all at once', async () => {
    /*
     * The ceiling has to mean the same thing whether attempts are serial or
     * simultaneous, and it did not: reading the counter before argon2 and
     * incrementing it after left ~40ms in which every arriving request saw the
     * same number. A ceiling of 3 admitted 24 of 25 concurrent attempts.
     *
     * `Promise.all` on the requests rather than a loop is the whole point —
     * this test passes trivially if the attempts are allowed to serialise.
     */
    const email = nextEmail();
    await register(email);

    /*
     * Ten at once, not fifty: past roughly a dozen simultaneous sockets the
     * in-process test server starts resetting connections, and a `ECONNRESET`
     * would fail this test for a reason that has nothing to do with the
     * ceiling. Ten is comfortably inside that and still more than three times
     * the limit — the broken shape admitted every one of them.
     */
    const responses = await Promise.all(Array.from({ length: BURST }, () => attempt(email)));
    const verified = responses.filter((response) => response.status === 401);

    expect(verified).toHaveLength(ACCOUNT_LIMIT);
  });

  it('holds the address ceiling when the attempts arrive all at once', async () => {
    // The same race on the other counter, in the shape it exists to catch: one
    // attempt each against many addresses, so no account ceiling is involved.
    const responses = await Promise.all(Array.from({ length: BURST }, () => attempt(nextEmail())));
    const verified = responses.filter((response) => response.status === 401);

    expect(verified).toHaveLength(IP_LIMIT);
  });

  it('refuses the correct password too, once the ceiling is reached', async () => {
    /*
     * The point of a lockout: it stops the attempt before the credential is
     * examined, so an attacker who finally guesses right on attempt N+1 still
     * gets nothing.
     */
    const email = nextEmail();
    await register(email);

    for (let index = 0; index < ACCOUNT_LIMIT; index += 1) await attempt(email).expect(401);

    await attempt(email, password).expect(429);
  });

  it('treats an unregistered address exactly like a registered one', async () => {
    /*
     * The enumeration property, and the reason the bucket is keyed by the
     * email rather than by a user id. Keyed by id, this address would have no
     * counter at all and would answer 401 forever while a real account locked
     * out — which tells an attacker precisely what the shared error code and
     * the decoy verification exist to hide.
     */
    const unknown = nextEmail();

    const codes: number[] = [];
    for (let index = 0; index < ACCOUNT_LIMIT; index += 1) {
      codes.push((await attempt(unknown)).status);
    }
    codes.push((await attempt(unknown)).status);

    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('answers the same code and body for an unknown address and a wrong password', async () => {
    const known = nextEmail();
    await register(known);

    const unknownResponse = await attempt(nextEmail()).expect(401);
    const knownResponse = await attempt(known).expect(401);

    expect(unknownResponse.body.error.code).toBe(knownResponse.body.error.code);
    expect(unknownResponse.body.error.message).toBe(knownResponse.body.error.message);
  });

  it('clears the account count when the password is finally right', async () => {
    const email = nextEmail();
    await register(email);

    await attempt(email).expect(401);
    await attempt(email).expect(401);

    await request(server())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    // Back to a full allowance: without the reset, the two failures above
    // would still be counted and the third would lock the account.
    await attempt(email).expect(401);
    await attempt(email).expect(401);
    await attempt(email).expect(401);
    await attempt(email).expect(429);
  });

  it('keeps counting the address after a successful login', async () => {
    /*
     * D73. The IP bucket survives on purpose: one correct password says
     * nothing about the other accounts being tried from the same place. If a
     * success cleared it, the ceiling would fall to "fail a few times, log
     * into an account you own, repeat forever".
     */
    const victims = [nextEmail(), nextEmail()];
    for (const email of victims) await register(email);

    const mine = nextEmail();
    await register(mine);

    /*
     * Four failures, spread two per account so no single account ceiling is
     * hit — the shape the IP ceiling exists to catch and the account ceiling
     * cannot see. Four of an allowance of six, leaving room for the login
     * below to succeed.
     */
    for (const email of victims) {
      await attempt(email).expect(401);
      await attempt(email).expect(401);
    }

    // A genuine login in the middle of the attack, which clears only its own
    // account bucket.
    await request(server()).post('/auth/login').send({ email: mine, password }).expect(200);

    // Two more failures reach the address ceiling of six. They only do so if
    // the successful login left the count at four — had it cleared the bucket,
    // these would be attempts one and two of a fresh allowance and the
    // request below would answer 401.
    const other = nextEmail();
    await register(other);
    await attempt(other).expect(401);
    await attempt(other).expect(401);

    await attempt(nextEmail()).expect(429);
  });

  it('takes the same time for an unknown address as for a wrong password', async () => {
    /*
     * The same indistinguishability as the test above, measured on the clock
     * instead of read off the body — and the one that was actually broken.
     *
     * `AuthService.login` verifies a decoy hash when the address has no
     * account, so both paths spend one argon2 verification. That decoy shipped
     * as a hand-written constant which was not a valid argon2 string at all:
     * verification rejected it as malformed in microseconds, and the endpoint
     * answered 8.0ms median for an unknown address against 36.3ms for a known
     * one, in disjoint ranges. One request, and an attacker knows.
     */
    const known = nextEmail();
    await register(known);

    // Out of the way: this test needs more attempts than the ceilings above
    // allow, and what it measures is the credential path, not the throttle.
    await configuration.set(AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key, 1_000, {
      actor: { type: 'system' },
    });
    await configuration.set(AUTH_LOGIN_MAX_FAILURES_PER_IP.key, 1_000, {
      actor: { type: 'system' },
    });

    const timedAttempt = async (email: string): Promise<number> => {
      const started = process.hrtime.bigint();
      await attempt(email).expect(401);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    await timedAttempt(known);

    const unknownTimes: number[] = [];
    const knownTimes: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      // Interleaved, so a machine that gets busy halfway through slows both
      // samples rather than only the second one.
      unknownTimes.push(await timedAttempt(nextEmail()));
      knownTimes.push(await timedAttempt(known));
    }

    const median = (values: number[]): number =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

    // A ratio rather than a difference, so the assertion does not encode this
    // machine's speed. The broken constant scored 0.22 here.
    expect(median(unknownTimes) / median(knownTimes)).toBeGreaterThan(0.6);
  });

  it('reads its thresholds from configuration at request time', async () => {
    const email = nextEmail();
    await register(email);

    await configuration.set(AUTH_LOGIN_MAX_FAILURES_PER_ACCOUNT.key, 1, {
      actor: { type: 'system' },
    });

    await attempt(email).expect(401);
    await attempt(email).expect(429);
  });

  it('refuses to authenticate at all when the counters cannot be read', async () => {
    /*
     * §15.4: rate limiting fails closed. Every other cache dependency in this
     * system degrades open; this one is a control, and an unavailable control
     * is not a reason to stop controlling.
     *
     * The connection is disconnected rather than the server stopped, which
     * makes the failure precise, immediate and local to this test.
     */
    const email = nextEmail();
    await register(email);

    redis.disconnect();

    try {
      const refused = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(503);

      expect(refused.body.error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    } finally {
      await redis.connect();
    }

    // And it recovers once the control is back, rather than staying broken.
    await request(server()).post('/auth/login').send({ email, password }).expect(200);
  });

  it('still logs a user in when the reservation cannot be released', async () => {
    /*
     * The asymmetry that remains, and it is the design: taking a place in the
     * counter is the control, so it fails closed; giving it back is cleanup
     * after a credential that has already been proven, so it fails open. A
     * successful login must not become a 500 because a `DEL` did not land — the
     * count is one too high for the rest of the window, which errs towards
     * refusing rather than admitting.
     *
     * The failure is injected at the Redis client the service actually holds,
     * rather than at the service method, so the swallowing under test is the
     * production code's and not the test's.
     */
    const email = nextEmail();
    await register(email);

    const original = redis.del.bind(redis);
    (redis as { del: unknown }).del = async () => {
      throw new Error('Connection is closed.');
    };

    try {
      await request(server()).post('/auth/login').send({ email, password }).expect(200);
    } finally {
      (redis as { del: unknown }).del = original;
    }
  });
});
