import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@gemone/contracts';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/auth.constants';
import { TokenService } from '../../src/modules/auth/token.service';

/**
 * Authentication flows against a real Postgres — ARCHITECTURE.md §18.3.
 *
 * These exercise the whole pipeline: validation pipe, global guards, the
 * exception filter, cookie handling, and real rows. Rotation and reuse
 * detection in particular cannot be tested against a mock, because the
 * behaviour being verified IS the database state transition.
 */
describe('authentication (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `user${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // The same parser and the same pipe factory main.ts uses. A test that
    // configures its own approximation verifies an application that does not
    // ship.
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    /*
     * Deleted inwards-out, along the foreign keys. Conversions reference
     * clicks and postbacks; clicks reference users. Getting the order wrong
     * fails only when a *previous file* left rows behind, which is why it
     * survived several green runs before showing up.
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
  });

  const server = () => app.getHttpServer();

  const cookiesFrom = (response: request.Response): string[] => {
    const raw = response.headers['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };

  const refreshCookie = (response: request.Response): string | undefined =>
    cookiesFrom(response).find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

  const tokenFromCookie = (cookie: string): string =>
    decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!);

  async function registerUser(email = nextEmail()) {
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    return { email, response };
  }

  describe('registration', () => {
    it('creates an account and returns a session', async () => {
      const email = nextEmail();
      const response = await request(server())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      expect(response.body.user.email).toBe(email);
      expect(response.body.user.role).toBe('USER');
      expect(response.body.user.status).toBe('ACTIVE');
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
    });

    it('never returns the password hash', async () => {
      const { response } = await registerUser();

      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });

    it('never returns the refresh token in the body', async () => {
      const { response } = await registerUser();

      // It travels only in the httpOnly cookie. In the body it would be
      // readable by any script on the page, which defeats the design.
      expect(response.body.refreshToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(
        tokenFromCookie(refreshCookie(response)!),
      );
    });

    it('sets an httpOnly, SameSite=Lax refresh cookie scoped to /auth', async () => {
      const { response } = await registerUser();
      const cookie = refreshCookie(response);

      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/auth');
    });

    it('stores only a hash of the refresh token', async () => {
      const { response } = await registerUser();
      const plaintext = tokenFromCookie(refreshCookie(response)!);

      const stored = await prisma.refreshToken.findMany();

      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).not.toBe(plaintext);
      expect(stored[0]!.tokenHash).toBe(TokenService.hashForLookup(plaintext));
    });

    it('rejects a duplicate email regardless of casing or whitespace', async () => {
      const email = nextEmail();
      await request(server()).post('/auth/register').send({ email, password }).expect(201);

      const response = await request(server())
        .post('/auth/register')
        .send({ email: `  ${email.toUpperCase()}  `, password })
        .expect(409);

      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_EMAIL_TAKEN);
    });

    it('rejects a weak password', async () => {
      const response = await request(server())
        .post('/auth/register')
        .send({ email: nextEmail(), password: 'short' })
        .expect(422);

      expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('rejects a malformed email', async () => {
      await request(server())
        .post('/auth/register')
        .send({ email: 'not-an-email', password })
        .expect(422);
    });

    it('rejects unknown properties instead of ignoring them', async () => {
      // A client sending `role: ADMIN` must be told it did nothing, not have
      // it silently dropped.
      await request(server())
        .post('/auth/register')
        .send({ email: nextEmail(), password, role: 'ADMIN' })
        .expect(422);
    });

    it('returns per-field detail for validation failures', async () => {
      const response = await request(server())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(422);

      // The documented ApiErrorResponse.fields shape, actually populated.
      const fields = response.body.error.fields as { field: string }[];
      expect(fields.map((f) => f.field).sort()).toEqual(['email', 'password']);
      expect(response.body.error.correlationId).toEqual(expect.any(String));
    });

    it('cannot be used to create an admin', async () => {
      const email = nextEmail();
      await request(server()).post('/auth/register').send({ email, password }).expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.role).toBe('USER');
    });
  });

  describe('login', () => {
    it('accepts correct credentials', async () => {
      const { email } = await registerUser();

      const response = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      expect(response.body.user.email).toBe(email);
      expect(refreshCookie(response)).toBeDefined();
    });

    it('is case-insensitive about the email', async () => {
      const { email } = await registerUser();

      await request(server())
        .post('/auth/login')
        .send({ email: email.toUpperCase(), password })
        .expect(200);
    });

    it('rejects a wrong password', async () => {
      const { email } = await registerUser();

      const response = await request(server())
        .post('/auth/login')
        .send({ email, password: 'wrong-password-entirely' })
        .expect(401);

      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    });

    it('returns the same error for an unknown email as for a wrong password', async () => {
      const { email } = await registerUser();

      const wrongPassword = await request(server())
        .post('/auth/login')
        .send({ email, password: 'wrong-password-entirely' })
        .expect(401);

      const unknownEmail = await request(server())
        .post('/auth/login')
        .send({ email: nextEmail(), password })
        .expect(401);

      // Distinguishing them turns login into an account-enumeration oracle.
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('opens a separate token family per login', async () => {
      const { email } = await registerUser();
      await request(server()).post('/auth/login').send({ email, password }).expect(200);

      const families = new Set(
        (await prisma.refreshToken.findMany()).map((t) => t.familyId),
      );

      // Revoking one compromised session must not log the user out everywhere.
      expect(families.size).toBe(2);
    });

    it('refuses a suspended account', async () => {
      const { email } = await registerUser();
      await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      const response = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(403);

      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_ACCOUNT_INACTIVE);
    });

    it('does not reveal account status to someone with the wrong password', async () => {
      const { email } = await registerUser();
      await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      const response = await request(server())
        .post('/auth/login')
        .send({ email, password: 'wrong-password-entirely' })
        .expect(401);

      // Status is checked after the password precisely so that guessing an
      // email cannot confirm the address exists.
      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    });
  });

  describe('current user', () => {
    it('returns the caller profile with a valid access token', async () => {
      const { email, response } = await registerUser();

      const me = await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .expect(200);

      expect(me.body.email).toBe(email);
      expect(me.body.passwordHash).toBeUndefined();
    });

    it('requires authentication', async () => {
      const response = await request(server()).get('/users/me').expect(401);

      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
    });

    it('rejects a malformed or forged token', async () => {
      await request(server())
        .get('/users/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      await request(server())
        .get('/users/me')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.wrong')
        .expect(401);
    });

    it('rejects a valid token whose account was suspended after issuance', async () => {
      const { email, response } = await registerUser();
      const token = response.body.accessToken;

      await request(server()).get('/users/me').set('Authorization', `Bearer ${token}`).expect(200);

      await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      // The guard re-reads the user on every request precisely so that
      // suspension takes effect immediately rather than when the access token
      // happens to expire (§8.3).
      const after = await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(after.body.error.code).toBe(ERROR_CODES.AUTH_ACCOUNT_INACTIVE);
    });
  });

  describe('refresh rotation', () => {
    it('exchanges the cookie for a new session', async () => {
      const { response } = await registerUser();
      const cookie = refreshCookie(response)!;

      const refreshed = await request(server())
        .post('/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);

      expect(refreshed.body.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(refreshed)).toBeDefined();
    });

    it('issues a different refresh token each time', async () => {
      const { response } = await registerUser();
      const first = tokenFromCookie(refreshCookie(response)!);

      const refreshed = await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(response)!)
        .expect(200);

      expect(tokenFromCookie(refreshCookie(refreshed)!)).not.toBe(first);
    });

    it('keeps the rotated token in the same family', async () => {
      const { response } = await registerUser();

      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(response)!)
        .expect(200);

      const families = new Set(
        (await prisma.refreshToken.findMany()).map((t) => t.familyId),
      );
      expect(families.size).toBe(1);
    });

    it('marks the old token spent', async () => {
      const { response } = await registerUser();
      const original = tokenFromCookie(refreshCookie(response)!);

      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(response)!)
        .expect(200);

      const spent = await prisma.refreshToken.findUnique({
        where: { tokenHash: TokenService.hashForLookup(original) },
      });

      expect(spent!.usedAt).not.toBeNull();
    });

    it('rejects an unknown refresh token', async () => {
      const response = await request(server())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=completely-made-up`)
        .expect(401);

      expect(response.body.error.code).toBe(ERROR_CODES.AUTH_REFRESH_INVALID);
    });

    it('rejects a request with no refresh token at all', async () => {
      await request(server()).post('/auth/refresh').expect(401);
    });

    it('accepts the token in the body for non-browser clients', async () => {
      const { response } = await registerUser();

      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken: tokenFromCookie(refreshCookie(response)!) })
        .expect(200);
    });

    it('rejects refreshing an account suspended mid-session', async () => {
      const { email, response } = await registerUser();
      await prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      const refreshed = await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(response)!)
        .expect(403);

      expect(refreshed.body.error.code).toBe(ERROR_CODES.AUTH_ACCOUNT_INACTIVE);
    });
  });

  describe('reuse detection', () => {
    it('revokes the entire family when a spent token is replayed', async () => {
      const { response } = await registerUser();
      const originalCookie = refreshCookie(response)!;

      const rotated = await request(server())
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(200);

      // Replaying the already-spent token: either a stolen token or a tab
      // race. Both are handled correctly by revoking everything.
      const replay = await request(server())
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(401);

      expect(replay.body.error.code).toBe(ERROR_CODES.AUTH_REFRESH_INVALID);

      // The critical part: the token issued by the legitimate rotation must
      // also be dead. Otherwise a thief who replays an old token leaves the
      // victim's current session intact and keeps their own alive.
      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(rotated)!)
        .expect(401);

      const tokens = await prisma.refreshToken.findMany();
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
      expect(tokens.some((t) => t.revokedReason === 'reuse_detected')).toBe(true);
    });

    it('does not revoke a different login session', async () => {
      const { email, response: first } = await registerUser();
      const second = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(first)!)
        .expect(200);
      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(first)!)
        .expect(401);

      // Families are per-login, so a compromised session on one device must
      // not log the user out on another.
      await request(server())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie(second)!)
        .expect(200);
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const { response } = await registerUser();
      const cookie = refreshCookie(response)!;

      const loggedOut = await request(server())
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      const cleared = refreshCookie(loggedOut);
      expect(cleared).toBeDefined();
      expect(cleared).toContain('Path=/auth');

      await request(server()).post('/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('is idempotent', async () => {
      const { response } = await registerUser();
      const cookie = refreshCookie(response)!;

      await request(server()).post('/auth/logout').set('Cookie', cookie).expect(204);
      // A client that gets an error from logout learns to ignore logout errors.
      await request(server()).post('/auth/logout').set('Cookie', cookie).expect(204);
    });

    it('succeeds with no session at all', async () => {
      await request(server()).post('/auth/logout').expect(204);
    });

    it('works without a valid access token', async () => {
      // Logging out must work when the access token has already expired —
      // that is exactly when a user reaches for it.
      const { response } = await registerUser();

      await request(server())
        .post('/auth/logout')
        .set('Cookie', refreshCookie(response)!)
        .set('Authorization', 'Bearer expired-nonsense')
        .expect(204);
    });
  });

  describe('audit fields', () => {
    it('records creation and update timestamps on the user', async () => {
      const { email } = await registerUser();

      const user = await prisma.user.findUnique({ where: { email } });

      expect(user!.createdAt).toBeInstanceOf(Date);
      expect(user!.updatedAt).toBeInstanceOf(Date);
    });

    it('records the issuing context against the session', async () => {
      await request(server())
        .post('/auth/register')
        .set('User-Agent', 'IntegrationTest/1.0')
        .send({ email: nextEmail(), password })
        .expect(201);

      const token = (await prisma.refreshToken.findMany())[0]!;

      expect(token.issuedUserAgent).toBe('IntegrationTest/1.0');
      expect(token.issuedIp).toEqual(expect.any(String));
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('records why a token was revoked', async () => {
      const { response } = await registerUser();

      await request(server())
        .post('/auth/logout')
        .set('Cookie', refreshCookie(response)!)
        .expect(204);

      const token = (await prisma.refreshToken.findMany())[0]!;
      expect(token.revokedReason).toBe('logout');
    });
  });

  describe('health endpoints remain public', () => {
    it('does not require authentication', async () => {
      // Global authentication must not break the probes that Docker and the
      // uptime monitor call without credentials.
      await request(server()).get('/health').expect(200);
      await request(server()).get('/health/ready').expect(200);
    });
  });
});
