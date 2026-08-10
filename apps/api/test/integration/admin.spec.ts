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

/**
 * Admin foundation against a real Postgres — ARCHITECTURE.md §18.3.
 *
 * The behaviour worth verifying here is not "the endpoint returns 200". It is
 * that role enforcement cannot be bypassed, that a status change and its audit
 * entry and its session revocation either all happen or none do, and that the
 * audit trail records enough to answer "who did this and why" months later.
 */
describe('admin foundation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `admin-test-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // Clicks reference users, offers and providers, so they go first.
    /*
     * Deleted inwards-out, along the foreign keys. Conversions reference
     * clicks and postbacks; clicks reference users.
     */
    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  const server = () => app.getHttpServer();

  async function createUser(role: 'USER' | 'ADMIN' = 'USER') {
    const email = nextEmail();
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    if (role === 'ADMIN') {
      // Admins are provisioned, never self-registered (ARCHITECTURE.md §8.4).
      // A seed script does this in production; the test does it directly.
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });

      const relogin = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      return { email, id: relogin.body.user.id, token: relogin.body.accessToken };
    }

    return { email, id: response.body.user.id, token: response.body.accessToken };
  }

  describe('role-based authorization', () => {
    it('lets an admin reach the admin surface', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });

    it('refuses a regular user with 403, not 404', async () => {
      const user = await createUser('USER');

      const response = await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);

      expect(response.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await request(server()).get('/admin/users').expect(401);
    });

    it('protects every admin endpoint, not just the listed one', async () => {
      const user = await createUser('USER');
      const target = await createUser('USER');
      const auth = { Authorization: `Bearer ${user.token}` };

      // The role is declared on the controller precisely so a new endpoint
      // cannot be added without it.
      await request(server()).get('/admin/users').set(auth).expect(403);
      await request(server()).get(`/admin/users/${target.id}`).set(auth).expect(403);
      await request(server()).get('/admin/audit-log').set(auth).expect(403);
      await request(server())
        .patch(`/admin/users/${target.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED', reason: 'testing access control' })
        .expect(403);
      await request(server())
        .post(`/admin/users/${target.id}/revoke-sessions`)
        .set(auth)
        .send({ reason: 'testing access control' })
        .expect(403);
    });

    it('stops working the moment the admin role is taken away', async () => {
      const admin = await createUser('ADMIN');
      await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } });

      // The guard re-reads the user on every request, so a demotion takes
      // effect immediately rather than when the access token expires.
      await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(403);
    });
  });

  describe('user listing', () => {
    it('paginates and reports the true total', async () => {
      const admin = await createUser('ADMIN');
      await createUser('USER');
      await createUser('USER');

      const response = await request(server())
        .get('/admin/users?limit=2')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBe(3);
      expect(response.body.limit).toBe(2);
    });

    it('filters by status and by role', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await prisma.user.update({ where: { id: user.id }, data: { status: 'BANNED' } });

      const banned = await request(server())
        .get('/admin/users?status=BANNED')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(banned.body.items.map((u: { id: string }) => u.id)).toEqual([user.id]);

      const admins = await request(server())
        .get('/admin/users?role=ADMIN')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(admins.body.items.map((u: { id: string }) => u.id)).toEqual([admin.id]);
    });

    it('rejects an out-of-range limit rather than silently clamping at the API', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .get('/admin/users?limit=5000')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });

    it('reports active session counts', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .get(`/admin/users/${user.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.activeSessionCount).toBe(1);
    });

    it('never exposes secrets in the admin view', async () => {
      const admin = await createUser('ADMIN');
      await createUser('USER');

      const response = await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });

    it('404s on an unknown user and 422s on a malformed id', async () => {
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .get('/admin/users/0192f0a0-0000-7000-8000-00000000dead')
        .set(auth)
        .expect(404);

      await request(server()).get('/admin/users/not-a-uuid').set(auth).expect(422);
    });
  });

  describe('status management', () => {
    it('suspends a user and revokes their sessions in one action', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'SUSPENDED', reason: 'suspected multi-accounting' })
        .expect(200);

      expect(response.body.status).toBe('SUSPENDED');
      expect(response.body.activeSessionCount).toBe(0);

      // The user's access token must stop working immediately.
      await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
    });

    it('reinstates a suspended user', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED', reason: 'suspected multi-accounting' })
        .expect(200);

      const reinstated = await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'ACTIVE', reason: 'investigation cleared the account' })
        .expect(200);

      expect(reinstated.body.status).toBe('ACTIVE');
    });

    it('requires a reason', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED' })
        .expect(422);

      // A one-character reason satisfies "required" without satisfying the
      // requirement, so a minimum length is enforced.
      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED', reason: 'x' })
        .expect(422);
    });

    it('rejects an unknown status', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'DELETED', reason: 'not a real status' })
        .expect(422);
    });

    it('rejects a no-op transition', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'ACTIVE', reason: 'already active, should fail' })
        .expect(409);

      expect(response.body.error.code).toBe(ERROR_CODES.USER_INVALID_STATUS_TRANSITION);
    });

    it('treats CLOSED as terminal', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'CLOSED', reason: 'user requested account closure' })
        .expect(200);

      // Reactivation is impossible because the data needed to reactivate is
      // gone once the account is anonymised (DATABASE.md §7.3).
      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'ACTIVE', reason: 'trying to undo a closure' })
        .expect(409);
    });

    it('refuses to let an admin change their own status', async () => {
      const admin = await createUser('ADMIN');

      // On a single-admin deployment this is unrecoverable without database
      // access.
      const response = await request(server())
        .patch(`/admin/users/${admin.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'SUSPENDED', reason: 'attempting to lock myself out' })
        .expect(403);

      expect(response.body.error.code).toBe(ERROR_CODES.ADMIN_SELF_ACTION_FORBIDDEN);
    });

    it('leaves nothing behind when the action is rejected', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'ACTIVE', reason: 'already active, should fail' })
        .expect(409);

      // No audit entry for an action that did not happen, and the user's
      // sessions are untouched.
      expect(await prisma.adminAuditLog.count()).toBe(0);
      await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
    });
  });

  describe('session revocation', () => {
    it('ends sessions without changing standing', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .post(`/admin/users/${user.id}/revoke-sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'session believed compromised' })
        .expect(201);

      expect(response.body.revoked).toBe(1);

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after!.status).toBe('ACTIVE');
    });
  });

  describe('audit trail', () => {
    it('records who, what, why, before and after', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'BANNED', reason: 'confirmed fraudulent conversions' })
        .expect(200);

      const entries = await prisma.adminAuditLog.findMany();
      expect(entries).toHaveLength(1);

      const entry = entries[0]!;
      expect(entry.adminId).toBe(admin.id);
      expect(entry.action).toBe('user.status_changed');
      expect(entry.targetType).toBe('user');
      expect(entry.targetId).toBe(user.id);
      expect(entry.reason).toBe('confirmed fraudulent conversions');
      expect(entry.before).toEqual({ status: 'ACTIVE' });
      expect(entry.after).toEqual({ status: 'BANNED' });
      expect(entry.ip).toEqual(expect.any(String));
    });

    it('is readable through the admin API, newest first', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED', reason: 'first action recorded' })
        .expect(200);
      await request(server())
        .post(`/admin/users/${user.id}/revoke-sessions`)
        .set(auth)
        .send({ reason: 'second action recorded' })
        .expect(201);

      const log = await request(server())
        .get('/admin/audit-log')
        .set(auth)
        .expect(200);

      expect(log.body.total).toBe(2);
      expect(log.body.items[0].action).toBe('user.sessions_revoked');
      expect(log.body.items[1].action).toBe('user.status_changed');
    });

    it('filters by target', async () => {
      const admin = await createUser('ADMIN');
      const a = await createUser('USER');
      const b = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${a.id}/status`)
        .set(auth)
        .send({ status: 'SUSPENDED', reason: 'action against user a' })
        .expect(200);
      await request(server())
        .patch(`/admin/users/${b.id}/status`)
        .set(auth)
        .send({ status: 'BANNED', reason: 'action against user b' })
        .expect(200);

      const filtered = await request(server())
        .get(`/admin/audit-log?targetId=${a.id}`)
        .set(auth)
        .expect(200);

      expect(filtered.body.total).toBe(1);
      expect(filtered.body.items[0].targetId).toBe(a.id);
    });

    it('exposes no way to write or delete an entry through the API', async () => {
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      // The trail is append-only and written only as a side effect of a real
      // action (DATABASE.md §7.1).
      await request(server()).post('/admin/audit-log').set(auth).send({}).expect(404);
      await request(server()).delete('/admin/audit-log').set(auth).expect(404);
    });
  });

  describe('self-service profile', () => {
    it('updates the caller locale', async () => {
      const user = await createUser('USER');

      const response = await request(server())
        .patch('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ locale: 'ar-EG' })
        .expect(200);

      expect(response.body.locale).toBe('ar-EG');
    });

    it('rejects a malformed locale', async () => {
      const user = await createUser('USER');

      await request(server())
        .patch('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ locale: '../../etc/passwd' })
        .expect(422);
    });

    it('refuses attempts to self-promote through the profile endpoint', async () => {
      const user = await createUser('USER');

      await request(server())
        .patch('/users/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ role: 'ADMIN' })
        .expect(422);

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after!.role).toBe('USER');
    });

    it('requires authentication', async () => {
      await request(server()).patch('/users/me').send({ locale: 'en' }).expect(401);
    });

    describe('password change', () => {
      it('changes the password and ends every session', async () => {
        const user = await createUser('USER');
        const newPassword = 'a-completely-different-passphrase';

        await request(server())
          .post('/users/me/password')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ currentPassword: password, newPassword })
          .expect(204);

        // Logging out everywhere is the point: the usual reason to change a
        // password is suspecting it is compromised.
        expect(
          await prisma.refreshToken.count({
            where: { userId: user.id, revokedAt: null },
          }),
        ).toBe(0);

        await request(server())
          .post('/auth/login')
          .send({ email: user.email, password: newPassword })
          .expect(200);

        await request(server())
          .post('/auth/login')
          .send({ email: user.email, password })
          .expect(401);
      });

      it('requires the current password, because a token is not a person', async () => {
        const user = await createUser('USER');

        const response = await request(server())
          .post('/users/me/password')
          .set('Authorization', `Bearer ${user.token}`)
          .send({
            currentPassword: 'not-the-current-password',
            newPassword: 'a-completely-different-passphrase',
          })
          .expect(401);

        expect(response.body.error.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);

        // Nothing changed: the old password still works.
        await request(server())
          .post('/auth/login')
          .send({ email: user.email, password })
          .expect(200);
      });

      it('enforces the password policy on the new password', async () => {
        const user = await createUser('USER');

        await request(server())
          .post('/users/me/password')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ currentPassword: password, newPassword: 'short' })
          .expect(422);
      });

      it('leaves the refresh cookie unusable afterwards', async () => {
        const email = nextEmail();
        const registered = await request(server())
          .post('/auth/register')
          .send({ email, password })
          .expect(201);

        const raw = registered.headers['set-cookie'];
        const cookies = Array.isArray(raw) ? raw : [raw];
        const cookie = cookies.find((c) => c?.startsWith(`${REFRESH_COOKIE_NAME}=`))!;

        await request(server())
          .post('/users/me/password')
          .set('Authorization', `Bearer ${registered.body.accessToken}`)
          .send({ currentPassword: password, newPassword: 'another-good-passphrase' })
          .expect(204);

        await request(server()).post('/auth/refresh').set('Cookie', cookie).expect(401);
      });
    });
  });
});
