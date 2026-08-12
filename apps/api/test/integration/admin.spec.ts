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
import { RewardAccountingService } from '../../src/modules/rewards/reward-accounting.service';

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
  let rewards: RewardAccountingService;

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
    // The balance tests move points the way everything else in the system
    // does — through the accounting service — rather than by writing rows.
    rewards = app.get(RewardAccountingService);
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
      await request(server()).get(`/admin/users/${target.id}/balance`).set(auth).expect(403);
      await request(server()).get('/admin/audit-log').set(auth).expect(403);
      await request(server())
        .patch(`/admin/users/${target.id}/role`)
        .set(auth)
        .send({ role: 'ADMIN', reason: 'testing access control' })
        .expect(403);
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

    /**
     * Searching by a fragment of an address — the regression.
     *
     * `UsersService.findMany` has always matched with `contains` and
     * `ListUsersQuery` has always documented a substring match, but
     * `ListUsersDto` validated the parameter with `@IsEmail`. The only queries
     * that passed were complete addresses, which is precisely the case a
     * search box is not needed for: `?email=admin-test` was answered *"must be
     * a valid email address"*.
     */
    describe('searching by email', () => {
      it('matches on a fragment, not only on a whole address', async () => {
        const admin = await createUser('ADMIN');
        const target = await createUser('USER');
        const fragment = target.email.slice(0, 12);

        const response = await request(server())
          .get(`/admin/users?email=${encodeURIComponent(fragment)}`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200);

        expect(response.body.items.map((u: { id: string }) => u.id)).toContain(target.id);
      });

      it('matches a whole address too', async () => {
        const admin = await createUser('ADMIN');
        const target = await createUser('USER');

        const response = await request(server())
          .get(`/admin/users?email=${encodeURIComponent(target.email)}`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200);

        expect(response.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);
      });

      it('ignores case, because addresses are stored normalised', async () => {
        const admin = await createUser('ADMIN');
        const target = await createUser('USER');

        const response = await request(server())
          .get(`/admin/users?email=${encodeURIComponent(target.email.toUpperCase())}`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200);

        expect(response.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);
      });

      it('answers a fragment that matches nobody with an empty page', async () => {
        const admin = await createUser('ADMIN');

        const response = await request(server())
          .get('/admin/users?email=nobody-has-this-fragment')
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200);

        // Empty, not an error: "no results" is a legitimate answer to a
        // search, and the screen has a state that says so.
        expect(response.body).toMatchObject({ total: 0, items: [] });
      });

      it('still bounds the parameter', async () => {
        const admin = await createUser('ADMIN');

        // The value reaches a `contains`. Unbounded is a query worth refusing
        // before the database sees it.
        await request(server())
          .get(`/admin/users?email=${'a'.repeat(400)}`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(422);
      });
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

  /**
   * One account's three buckets — TODO T84.
   *
   * The endpoint is four lines and the risk is entirely in what it *does not*
   * do: recompute. So these check the two things that would make an admin
   * screen lie — a figure that disagrees with the accounting service, and a
   * mistyped id answering `200` with zeros — rather than the shape of the JSON.
   */
  describe('user balance', () => {
    /**
     * Points moved the way the product moves them.
     *
     * A credit lands in `pending` because a hold period applies to it; the
     * maturation row is what moves it to `available`; a withdrawal request is
     * what reserves part of that into `locked`. Writing the three figures
     * directly would test the serializer against itself.
     */
    async function fundAccount(userId: string) {
      const matured = await rewards.credit({
        userId,
        amountPoints: 20_000,
        source: { type: 'CONVERSION', id: 'conv-balance-1', label: 'Quick Survey' },
      });
      await rewards.mature(matured.id);

      const held = await rewards.credit({
        userId,
        amountPoints: 3_000,
        source: { type: 'CONVERSION', id: 'conv-balance-2', label: 'Second Survey' },
      });

      await rewards.lock(userId, 5_000, 'payout-balance-1');

      return { matured, held };
    }

    it('returns the three buckets, each holding what the movements put there', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // 20,000 credited and matured, less 5,000 reserved by the withdrawal.
      expect(response.body.available).toBe(15_000);
      // The second credit, still inside its hold period.
      expect(response.body.pending).toBe(3_000);
      // Reserved by the in-flight request, and no longer withdrawable.
      expect(response.body.locked).toBe(5_000);
    });

    it('keeps the buckets distinct rather than collapsing them into one number', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /*
       * `total` is provided so nobody adds the three up wrongly — and it is
       * explicitly not the number to check a withdrawal against, which is why
       * all four are on the wire rather than a sum in place of the parts.
       */
      expect(response.body.total).toBe(23_000);
      expect(response.body.available + response.body.pending + response.body.locked).toBe(
        response.body.total,
      );
    });

    it('carries the lifetime figures the accounting service already keeps', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const { held } = await fundAccount(user.id);
      await rewards.reverse(held.id, 'chargeback');

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // What has passed through the account, which is a different question
      // from what is in it — and the one an operator asks before deciding
      // whether a withdrawal request is this account's first.
      expect(response.body.lifetimeEarned).toBe(23_000);
      expect(response.body.lifetimeReversed).toBe(3_000);
      expect(response.body.lifetimeWithdrawn).toBe(0);
    });

    it('agrees with the accounting service, field for field', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /*
       * The regression that matters. The admin endpoint composes
       * `getBalance` and reshapes nothing, so there is no second definition
       * of a balance to drift — this is what asserts that it stays that way.
       */
      expect(response.body).toEqual(await rewards.getBalance(user.id));
    });

    it('is the same answer the account holder gets for themselves', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const [own, administrative] = await Promise.all([
        request(server())
          .get('/rewards/balance')
          .set('Authorization', `Bearer ${user.token}`)
          .expect(200),
        request(server())
          .get(`/admin/users/${user.id}/balance`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(200),
      ]);

      // An operator and the person they are helping must not be reading two
      // different numbers while talking to each other.
      expect(administrative.body).toEqual(own.body);
    });

    it('reconciles against the history that produced it', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // PROJECT.md R4: the sums of the bucket deltas over a user's history
      // *are* that user's balance. What this endpoint serves is that number.
      const report = await rewards.reconcile(user.id);

      expect(report.balanced).toBe(true);
      expect(report.expected).toEqual({
        pending: response.body.pending,
        available: response.body.available,
        locked: response.body.locked,
      });
    });

    it('answers zeros for an account that has never earned anything', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // A real account with nothing in it. The status code is what separates
      // this from the next test, which is the whole reason the endpoint looks
      // the user up before reading the balance.
      expect(response.body).toMatchObject({ pending: 0, available: 0, locked: 0, total: 0 });
    });

    it('404s on an account that does not exist, rather than reporting a balance of nothing', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get('/admin/users/0192f0a0-0000-7000-8000-00000000dead/balance')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404);

      /*
       * `getBalance` answers zeros for an account with no stored balance,
       * which is right for its own caller and wrong here: an operator reading
       * "no points" about a mistyped id would conclude something false about
       * an account that exists somewhere else.
       */
      expect(response.body.error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    });

    it('422s on a malformed id', async () => {
      const admin = await createUser('ADMIN');

      await request(server())
        .get('/admin/users/not-a-uuid/balance')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });

    it('refuses a signed-in non-admin with 403', async () => {
      const user = await createUser('USER');
      const target = await createUser('USER');
      await fundAccount(target.id);

      const response = await request(server())
        .get(`/admin/users/${target.id}/balance`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);

      expect(response.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('refuses a user asking for their own balance through the admin path', async () => {
      const user = await createUser('USER');

      // The role is the control, not the ownership: `/rewards/balance` is
      // where a user reads their own, and it takes no id at all.
      await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      const target = await createUser('USER');

      await request(server()).get(`/admin/users/${target.id}/balance`).expect(401);
    });

    it('exposes the balance and nothing else about the account', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      await fundAccount(user.id);

      const response = await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /*
       * A payment destination is returned by exactly one endpoint and writes
       * an audit entry when it is (§16.4). This is not that endpoint, and an
       * allowlisted response shape is what keeps it from becoming one.
       */
      expect(Object.keys(response.body).sort()).toEqual([
        'available',
        'lifetimeEarned',
        'lifetimeReversed',
        'lifetimeWithdrawn',
        'locked',
        'pending',
        'total',
      ]);
    });

    it('is a read, and writes no audit entry', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .get(`/admin/users/${user.id}/balance`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /*
       * Deliberate. The destination read is audited because reading where
       * somebody's money goes is an action; a balance is the same class of
       * fact as the fraud signals beside it, and `PayoutReviewContext` has
       * carried these three numbers to admins since Feature 6 with no entry
       * written. Auditing it here alone would make the trail describe which
       * screen was used rather than what was done.
       */
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('offers no way to change a balance through the admin surface', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      /*
       * Points move because something happened — a conversion, a chargeback,
       * a withdrawal — and every one of those has its own surface. A writable
       * balance would be a way to move money with no event behind it.
       */
      await request(server())
        .patch(`/admin/users/${user.id}/balance`)
        .set(auth)
        .send({ available: 999_999 })
        .expect(404);

      await request(server())
        .post(`/admin/users/${user.id}/balance`)
        .set(auth)
        .send({ available: 999_999 })
        .expect(404);
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

  /**
   * Appointing and removing administrators — TODO T85, ARCHITECTURE.md §8.4.
   *
   * §8.4 has always said admin accounts are provisioned "by a seed script or by
   * an existing admin", and only the seed script existed. What is worth
   * verifying is not that a column changes: it is that the change takes effect
   * on the next request, that it is recorded, and that the platform cannot be
   * left with nobody able to administer it — including by two administrators
   * acting at the same moment, which no check made before a write can catch.
   */
  describe('role management', () => {
    const REASON = 'appointing a second operator for the launch';

    it('promotes an account, and the promotion is usable immediately', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server()).get('/admin/users').set({ Authorization: `Bearer ${user.token}` }).expect(403);

      const response = await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'ADMIN', reason: REASON })
        .expect(200);

      expect(response.body.role).toBe('ADMIN');

      /*
       * The same access token that was refused a moment ago. `JwtAuthGuard`
       * reads the role from the database on every request rather than from the
       * token (§8.3), so an appointment does not wait for a token to expire —
       * and the person being appointed does not have to sign in again.
       */
      await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
    });

    it('demotes an account, and the admin surface closes on the next request', async () => {
      const admin = await createUser('ADMIN');
      const other = await createUser('ADMIN');

      await request(server()).get('/admin/users').set({ Authorization: `Bearer ${other.token}` }).expect(200);

      await request(server())
        .patch(`/admin/users/${other.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER', reason: 'they have left the operations team' })
        .expect(200);

      await request(server())
        .get('/admin/users')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });

    it('leaves a demoted account able to use the rest of the application', async () => {
      const admin = await createUser('ADMIN');
      const other = await createUser('ADMIN');

      const sessions = () =>
        prisma.refreshToken.count({ where: { userId: other.id, revokedAt: null } });
      const before = await sessions();

      await request(server())
        .patch(`/admin/users/${other.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER', reason: 'they have left the operations team' })
        .expect(200);

      /*
       * Deliberately not revoked. A suspension revokes because the account must
       * stop being able to act at all; a demotion closes the admin surface and
       * nothing else, and signing the person out of their own account would be
       * a second consequence hidden inside this one.
       */
      await request(server())
        .get('/users/me')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      expect(await sessions()).toBe(before);
      expect(before).toBeGreaterThan(0);
    });

    it('records who did it, to whom, from what, to what, and why', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'ADMIN', reason: REASON })
        .expect(200);

      // The action existed in the vocabulary since Feature 2 and nothing wrote
      // it — that was half of what T85 was.
      const entry = await prisma.adminAuditLog.findFirst({
        where: { action: 'user.role_changed' },
      });

      expect(entry).toMatchObject({
        adminId: admin.id,
        targetType: 'user',
        targetId: user.id,
        before: { role: 'USER' },
        after: { role: 'ADMIN' },
        reason: REASON,
      });
    });

    it('requires a reason of a length worth reading', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set(auth)
        .send({ role: 'ADMIN' })
        .expect(422);

      await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set(auth)
        .send({ role: 'ADMIN', reason: 'x' })
        .expect(422);

      // Nothing happened on either attempt.
      expect((await prisma.user.findUnique({ where: { id: user.id } }))?.role).toBe('USER');
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('rejects a role the contract does not define', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'SUPERADMIN', reason: REASON })
        .expect(422);
    });

    it('refuses a change to the role the account already holds', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      const response = await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER', reason: REASON })
        .expect(409);

      expect(response.body.error.code).toBe(ERROR_CODES.USER_ROLE_UNCHANGED);
      // An audit entry recording a change that did not happen is worse than no
      // entry: it is a trail that disagrees with the account.
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('refuses to let an administrator demote themselves', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .patch(`/admin/users/${admin.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'USER', reason: 'stepping back from operations' })
        .expect(403);

      /*
       * The same rule `setStatus` applies, and more final here: a suspended
       * administrator can be reinstated by another administrator, a demoted one
       * cannot appoint themselves back.
       */
      expect(response.body.error.code).toBe(ERROR_CODES.ADMIN_SELF_ACTION_FORBIDDEN);
      expect((await prisma.user.findUnique({ where: { id: admin.id } }))?.role).toBe('ADMIN');
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('404s on an unknown account and 422s on a malformed id', async () => {
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch('/admin/users/0192f0a0-0000-7000-8000-00000000dead/role')
        .set(auth)
        .send({ role: 'ADMIN', reason: REASON })
        .expect(404);

      await request(server())
        .patch('/admin/users/not-a-uuid/role')
        .set(auth)
        .send({ role: 'ADMIN', reason: REASON })
        .expect(422);
    });

    it('refuses a signed-in non-admin, and an unauthenticated caller', async () => {
      const user = await createUser('USER');
      const target = await createUser('USER');
      const body = { role: 'ADMIN', reason: REASON };

      // The obvious attack this endpoint invites: promote yourself.
      const self = await request(server())
        .patch(`/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body)
        .expect(403);

      expect(self.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
      expect((await prisma.user.findUnique({ where: { id: user.id } }))?.role).toBe('USER');

      await request(server())
        .patch(`/admin/users/${target.id}/role`)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body)
        .expect(403);

      await request(server()).patch(`/admin/users/${target.id}/role`).send(body).expect(401);
    });

    it('cannot be reached through the status endpoint', async () => {
      const admin = await createUser('ADMIN');
      const user = await createUser('USER');

      /*
       * The validation pipe strips unknown properties and the DTO declares no
       * `role`, so this is a status change and nothing else. Worth pinning:
       * a whitelist that stopped forbidding extras would make every status
       * change a possible promotion.
       */
      await request(server())
        .patch(`/admin/users/${user.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'SUSPENDED', reason: REASON, role: 'ADMIN' })
        .expect(422);

      expect((await prisma.user.findUnique({ where: { id: user.id } }))?.role).toBe('USER');
    });

    /**
     * The case the self-action rule cannot see.
     *
     * Two administrators demoting each other are two legal requests: neither is
     * a self-action, and each one, checked on its own, leaves an administrator
     * behind. Only a lock makes the second request see what the first one did.
     */
    it('never lets two administrators demote each other into an empty platform', async () => {
      const first = await createUser('ADMIN');
      const second = await createUser('ADMIN');

      const results = await Promise.all([
        request(server())
          .patch(`/admin/users/${second.id}/role`)
          .set('Authorization', `Bearer ${first.token}`)
          .send({ role: 'USER', reason: 'reorganising the operations team' }),
        request(server())
          .patch(`/admin/users/${first.id}/role`)
          .set('Authorization', `Bearer ${second.token}`)
          .send({ role: 'USER', reason: 'reorganising the operations team' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

      const refused = results.find((r) => r.status === 409);
      expect(refused?.body.error.code).toBe(ERROR_CODES.ADMIN_LAST_ADMIN_PROTECTED);

      // One administrator left, and exactly one demotion recorded.
      expect(await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
      expect(await prisma.adminAuditLog.count({ where: { action: 'user.role_changed' } })).toBe(1);
    });

    it('does not count an administrator who cannot sign in', async () => {
      const first = await createUser('ADMIN');
      const second = await createUser('ADMIN');
      const suspended = await createUser('ADMIN');

      await prisma.user.update({
        where: { id: suspended.id },
        data: { status: 'SUSPENDED' },
      });

      /*
       * With a suspended administrator present, counting rows by role alone
       * would report one survivor and let both demotions through — leaving the
       * platform with an administrator who cannot sign in, which is none.
       * `JwtAuthGuard` refuses a non-ACTIVE account before the role is ever
       * consulted, so that is what the interlock counts.
       */
      const results = await Promise.all([
        request(server())
          .patch(`/admin/users/${second.id}/role`)
          .set('Authorization', `Bearer ${first.token}`)
          .send({ role: 'USER', reason: 'reorganising the operations team' }),
        request(server())
          .patch(`/admin/users/${first.id}/role`)
          .set('Authorization', `Bearer ${second.token}`)
          .send({ role: 'USER', reason: 'reorganising the operations team' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    });

    it('lets an administrator be demoted while another one remains', async () => {
      const first = await createUser('ADMIN');
      const second = await createUser('ADMIN');
      const third = await createUser('ADMIN');

      // The interlock refuses the *last* one, not a demotion in general.
      await request(server())
        .patch(`/admin/users/${second.id}/role`)
        .set('Authorization', `Bearer ${first.token}`)
        .send({ role: 'USER', reason: 'reorganising the operations team' })
        .expect(200);

      await request(server())
        .patch(`/admin/users/${third.id}/role`)
        .set('Authorization', `Bearer ${first.token}`)
        .send({ role: 'USER', reason: 'reorganising the operations team' })
        .expect(200);

      expect(await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
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
