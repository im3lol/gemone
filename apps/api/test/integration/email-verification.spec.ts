import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ERROR_CODES } from '@gemone/contracts';
import type { Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import {
  NOTIFICATION_JOBS,
  QUEUES,
  type VerificationEmailJobData,
} from '../../src/core/queue/queue.constants';
import { AUTH_EMAIL_VERIFICATION_TTL_SECONDS } from '../../src/modules/auth/auth.config';

/**
 * Email verification end to end — ARCHITECTURE.md §8.3, PROJECT.md M1.
 *
 * The token never leaves the system in a form the test can read from the
 * database: only its SHA-256 is stored. So the token is taken from the queued
 * job, which is also the only route the real delivery path has — if this test
 * can get the token this way, so can the worker, and if it cannot, neither can
 * a user.
 */
describe('email verification (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configuration: ConfigurationService;
  let queue: Queue;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `verify-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    configuration = app.get(ConfigurationService);
    queue = app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS));
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
  });

  beforeEach(async () => {
    // Inwards-out along the foreign keys, the same chain `auth.spec.ts` uses:
    // getting it wrong only fails when a previous file left rows behind.
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
    await queue.obliterate({ force: true });
  });

  const server = () => app.getHttpServer();

  /** Registers, and returns the token the queued job carries. */
  async function registerAndTakeToken(email: string): Promise<string> {
    await request(server()).post('/auth/register').send({ email, password }).expect(201);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const job = jobs.find(
      (candidate) => (candidate.data as VerificationEmailJobData).email === email,
    );
    expect(job, 'registration must queue a verification email').toBeDefined();
    expect(job!.name).toBe(NOTIFICATION_JOBS.VERIFICATION_EMAIL);

    return (job!.data as VerificationEmailJobData).token;
  }

  it('queues a verification email for a new registration', async () => {
    const email = nextEmail();
    const token = await registerAndTakeToken(email);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores only the hash of the token, never the token', async () => {
    // The value travels through an email, so every copy of it outside this
    // process is one we do not control. What is kept has to be useless.
    const token = await registerAndTakeToken(nextEmail());

    const rows = await prisma.verificationToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.purpose).toBe('EMAIL_VERIFICATION');
  });

  it('marks the address verified when the token is presented', async () => {
    const email = nextEmail();
    const token = await registerAndTakeToken(email);

    const before = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(before.emailVerifiedAt).toBeNull();

    await request(server()).post('/auth/verify-email').send({ token }).expect(204);

    const after = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it('refuses the same token a second time', async () => {
    /*
     * Single-use, and this is not a hypothetical: mail clients follow links to
     * scan them, so the second presentation often arrives before the user has
     * clicked anything at all.
     */
    const token = await registerAndTakeToken(nextEmail());

    await request(server()).post('/auth/verify-email').send({ token }).expect(204);
    const replay = await request(server()).post('/auth/verify-email').send({ token }).expect(400);

    expect(replay.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
  });

  it('refuses an expired token', async () => {
    // The TTL is a P3 value, so the test sets it through the configuration
    // service — which is also what proves it is not a literal in the code.
    await configuration.set(AUTH_EMAIL_VERIFICATION_TTL_SECONDS.key, 300, {
      actor: { type: 'system' },
    });

    const email = nextEmail();
    const token = await registerAndTakeToken(email);

    await prisma.verificationToken.updateMany({
      where: {},
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const refused = await request(server())
      .post('/auth/verify-email')
      .send({ token })
      .expect(400);
    expect(refused.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('answers the same way for a token that never existed', async () => {
    const invented = 'a'.repeat(43);

    const refused = await request(server())
      .post('/auth/verify-email')
      .send({ token: invented })
      .expect(400);

    expect(refused.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
  });

  it('leaves login working exactly as before, verified or not', async () => {
    /*
     * Verification gates nothing in this feature. An unverified account logs
     * in, and a verified one logs in the same way — recorded as a test because
     * "we did not change that" is the kind of claim that stops being true
     * without anyone noticing.
     */
    const email = nextEmail();
    const token = await registerAndTakeToken(email);

    await request(server()).post('/auth/login').send({ email, password }).expect(200);

    await request(server()).post('/auth/verify-email').send({ token }).expect(204);

    await request(server()).post('/auth/login').send({ email, password }).expect(200);
  });
});
