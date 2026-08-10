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
  type PasswordResetEmailJobData,
} from '../../src/core/queue/queue.constants';
import { AUTH_PASSWORD_RESET_TTL_SECONDS } from '../../src/modules/auth/auth.config';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/auth.constants';

/**
 * Password reset end to end — ARCHITECTURE.md §8.2, §8.3, PROJECT.md M1.
 *
 * Like the verification tokens, the reset token is only ever stored as a
 * SHA-256, so the test takes it from the queued job — the same and only route
 * the real delivery path has.
 */
describe('password reset (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configuration: ConfigurationService;
  let queue: Queue;

  const password = 'correct-horse-battery-staple';
  const newPassword = 'a-completely-different-secret';
  let counter = 0;
  const nextEmail = () => `reset-${++counter}.${Date.now()}@example.com`;

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
    // Inwards-out along the foreign keys, the same chain `auth.spec.ts` uses.
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

  async function register(email: string): Promise<request.Response> {
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    // Registration queues a verification email of its own; dropping it keeps
    // `takeResetToken` from having to tell the two apart by anything but name.
    await queue.obliterate({ force: true });
    return response;
  }

  /** Asks for a reset and returns the token the queued job carries. */
  async function takeResetToken(email: string): Promise<string> {
    await request(server()).post('/auth/forgot-password').send({ email }).expect(204);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const job = jobs.find((candidate) => candidate.name === NOTIFICATION_JOBS.PASSWORD_RESET_EMAIL);
    expect(job, 'a reset request must queue an email').toBeDefined();
    expect((job!.data as PasswordResetEmailJobData).email).toBe(email);

    return (job!.data as PasswordResetEmailJobData).token;
  }

  const refreshCookie = (response: request.Response): string => {
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`))!;
  };

  describe('requesting a link', () => {
    it('queues a reset email for a known address', async () => {
      const email = nextEmail();
      await register(email);

      const token = await takeResetToken(email);

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('stores only the hash, under the reset purpose', async () => {
      const email = nextEmail();
      await register(email);

      const token = await takeResetToken(email);

      // Filtered by purpose: the registration above left a verification token
      // of its own in the same table, which is the arrangement DATABASE.md
      // §3.1 asks for.
      const rows = await prisma.verificationToken.findMany({
        where: { purpose: 'PASSWORD_RESET' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).not.toBe(token);
      expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]!.purpose).toBe('PASSWORD_RESET');
    });

    it('answers identically for an address with no account, and sends nothing', async () => {
      /*
       * §8.3's requirement, and the reason this endpoint returns 204 rather
       * than anything informative: a different status, body or error code for
       * an unknown address turns "forgot password" into a way to ask whether
       * somebody has an account here.
       */
      const known = nextEmail();
      await register(known);

      // The control: what the endpoint does for an address that *does* have an
      // account. Without it, "204 and no email" would also be the answer of an
      // endpoint that is simply broken.
      const forKnown = await request(server()).post('/auth/forgot-password').send({ email: known });
      const issued = await prisma.verificationToken.count({ where: { purpose: 'PASSWORD_RESET' } });
      expect(issued).toBe(1);
      await queue.obliterate({ force: true });

      const forUnknown = await request(server())
        .post('/auth/forgot-password')
        .send({ email: 'nobody-at-all@example.com' });

      expect(forUnknown.status).toBe(forKnown.status);
      expect(forUnknown.status).toBe(204);
      expect(forUnknown.body).toEqual(forKnown.body);

      const queued = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      expect(queued).toHaveLength(0);
      expect(await prisma.verificationToken.count({ where: { purpose: 'PASSWORD_RESET' } })).toBe(
        issued,
      );
    });
  });

  describe('spending a link', () => {
    it('replaces the password: the old one stops working and the new one works', async () => {
      const email = nextEmail();
      await register(email);
      const token = await takeResetToken(email);

      await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);

      await request(server()).post('/auth/login').send({ email, password }).expect(401);
      await request(server()).post('/auth/login').send({ email, password: newPassword }).expect(200);
    });

    it('revokes every session the user already had', async () => {
      /*
       * §8.2 lists password change among the things a refresh token must be
       * revocable for, and this is why: nobody resets a password they can
       * still use, so a session alive at that moment is exactly the session
       * the user is trying to end.
       */
      const email = nextEmail();
      const registration = await register(email);
      const cookie = refreshCookie(registration);

      await request(server())
        .post('/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);

      const session = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const token = await takeResetToken(email);
      await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);

      const refused = await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(session))
        .expect(401);
      expect(refused.body.error.code).toBe(ERROR_CODES.AUTH_REFRESH_INVALID);

      const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
      expect(live).toBe(0);
    });

    it('does not issue a session of its own', async () => {
      // The holder of the token proved they can read an inbox, not that they
      // know a password. They log in like anyone else.
      const email = nextEmail();
      await register(email);
      const token = await takeResetToken(email);

      const response = await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body).toEqual({});
    });

    it('refuses the same token a second time', async () => {
      const email = nextEmail();
      await register(email);
      const token = await takeResetToken(email);

      await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);

      const replay = await request(server())
        .post('/auth/reset-password')
        .send({ token, password: 'yet-another-long-password' })
        .expect(400);
      expect(replay.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);

      // And the replay changed nothing: the password set by the first call
      // still works.
      await request(server()).post('/auth/login').send({ email, password: newPassword }).expect(200);
    });

    it('refuses an expired token', async () => {
      // Set through the configuration service, which is also what proves the
      // lifetime is a P3 value rather than a literal.
      await configuration.set(AUTH_PASSWORD_RESET_TTL_SECONDS.key, 300, {
        actor: { type: 'system' },
      });

      const email = nextEmail();
      await register(email);
      const token = await takeResetToken(email);

      await prisma.verificationToken.updateMany({
        where: {},
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const refused = await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(400);
      expect(refused.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);

      await request(server()).post('/auth/login').send({ email, password }).expect(200);
    });

    it('refuses a verification token presented as a reset token', async () => {
      /*
       * Both purposes live in one table and both tokens are 43 base64url
       * characters, so nothing about the value itself distinguishes them. If
       * the purpose were not part of the lookup, an emailed verification link
       * — issued to every registration, valid for a day — would be a password
       * reset.
       */
      const email = nextEmail();
      await request(server()).post('/auth/register').send({ email, password }).expect(201);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      const verification = jobs.find(
        (job) => job.name === NOTIFICATION_JOBS.VERIFICATION_EMAIL,
      );
      const verificationToken = (verification!.data as { token: string }).token;

      const refused = await request(server())
        .post('/auth/reset-password')
        .send({ token: verificationToken, password: newPassword })
        .expect(400);
      expect(refused.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);

      await request(server()).post('/auth/login').send({ email, password }).expect(200);
    });

    it('rejects a password that fails the policy without spending the token', async () => {
      /*
       * A token consumed by a rejected attempt would leave the user holding a
       * dead link because they typed something too short.
       *
       * Two independent things keep that from happening, and this pins the
       * outcome rather than either mechanism: the DTO rejects the body before
       * the service is reached, and — established by reverting both — a policy
       * failure raised *inside* the transaction rolls the consumption back
       * anyway. The service checks the policy before opening the transaction
       * for a different reason: argon2 takes ~40ms and should not spend it
       * holding a connection and a row lock.
       */
      const email = nextEmail();
      await register(email);
      const token = await takeResetToken(email);

      await request(server())
        .post('/auth/reset-password')
        .send({ token, password: 'short' })
        .expect(422);

      await request(server())
        .post('/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);
      await request(server()).post('/auth/login').send({ email, password: newPassword }).expect(200);
    });
  });
});
