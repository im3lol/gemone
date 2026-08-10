import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES, SYNC_MODES } from '@gemone/contracts';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import {
  CLICKS_MAX_PER_IP_PER_HOUR,
  CLICKS_MAX_PER_USER_PER_HOUR,
} from '../../src/modules/clicks/clicks.config';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * The click surface over HTTP, including the parts only a real request can
 * exercise: authentication, IP resolution, and the admin view.
 */
describe('click surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;

  let providerId: string;
  let offerId: string;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `click-http-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    providers = app.get(ProvidersService);
    catalog = app.get(CatalogSyncService);
    configuration = app.get(ConfigurationService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // Default: nothing in front of us, so X-Forwarded-For is ignored.
    app.getHttpAdapter().getInstance().set('trust proxy', 0);

    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.offerSyncRun.deleteMany();
    await prisma.offer.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.configurationHistory.deleteMany();
    await prisma.configurationValue.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.provider.deleteMany();
    configuration.invalidateAll();
    // Pinned to the rate these expectations were written against. The shipped
    // default changed from 1 to 10 when it was found to pay users a tenth of
    // the configured revenue share; what these tests check is mechanics, not
    // the launch economics, so they set the rate they depend on.
    await configuration.set(OFFERS_POINTS_PER_MINOR_UNIT.key, 1, {
      actor: { type: 'system' },
    });

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);

    offerId = (await prisma.offer.findFirstOrThrow({ where: { externalId: 'MK-100241' } })).id;
  });

  const server = () => app.getHttpServer();

  async function createUser(role: 'USER' | 'ADMIN' = 'USER') {
    const email = nextEmail();
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
      const relogin = await request(server())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return { email, id: relogin.body.user.id, token: relogin.body.accessToken };
    }

    return { email, id: response.body.user.id, token: response.body.accessToken };
  }

  describe('authentication', () => {
    it('refuses an unauthenticated click', async () => {
      // A click that cannot be attributed to an account is a promise to
      // nobody.
      await request(server()).post('/clicks').send({ offerId }).expect(401);
      expect(await prisma.click.count()).toBe(0);
    });

    it('refuses a suspended user immediately, not when their token expires', async () => {
      const user = await createUser();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      // The guard re-reads status on every request (§8.3). On a platform
      // holding withdrawable balances, the gap between suspending an account
      // and it taking effect is the gap in which fraud is cashed out.
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId })
        .expect(403);

      expect(await prisma.click.count()).toBe(0);
    });
  });

  describe('creating a click', () => {
    it('returns the redirect and records the row', async () => {
      const user = await createUser();

      const response = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('user-agent', 'Mozilla/5.0 (IntegrationTest)')
        .set('referer', 'https://wall.test/offers')
        .send({ offerId })
        .expect(201);

      expect(response.body.redirectUrl).toContain(response.body.subId);
      expect(response.body.rewardPoints).toBe(171);

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.body.id } });
      expect(stored.userId).toBe(user.id);
      expect(stored.userAgent).toBe('Mozilla/5.0 (IntegrationTest)');
      expect(stored.referrer).toBe('https://wall.test/offers');
    });

    it('rejects an unknown property rather than ignoring it', async () => {
      const user = await createUser();

      // `userId` is not part of the contract. Silently dropping it would let
      // a caller believe they had clicked on someone else's behalf.
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId, userId: '0192f0a0-0000-7000-8000-0000000000aa' })
        .expect(422);
    });

    it('rejects a malformed offer id with 422', async () => {
      const user = await createUser();

      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId: 'not-a-uuid' })
        .expect(422);
    });

    it('returns 429 when the click limit is hit', async () => {
      const user = await createUser();
      await configuration.set(CLICKS_MAX_PER_USER_PER_HOUR.key, 1, {
        actor: { type: 'system' },
      });

      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId })
        .expect(201);

      const limited = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId })
        .expect(429);

      expect(limited.body.error.code).toBe(ERROR_CODES.CLICK_RATE_LIMIT_EXCEEDED);
    });
  });

  describe('client IP resolution', () => {
    it('ignores X-Forwarded-For when nothing is trusted in front', async () => {
      const user = await createUser();

      const response = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('X-Forwarded-For', '198.51.100.99')
        .send({ offerId })
        .expect(201);

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.body.id } });

      /*
       * The security property behind TRUST_PROXY_HOPS defaulting to zero. If
       * a header any caller can send decided the stored IP, the per-IP click
       * limit would be a limit the attacker picks the key for — and the
       * geo-mismatch check `fraud` will run against this address would be
       * reading whatever the attacker typed.
       */
      expect(stored.ipAddress).not.toBe('198.51.100.99');
    });

    it('uses X-Forwarded-For once a proxy is trusted', async () => {
      app.getHttpAdapter().getInstance().set('trust proxy', 1);
      const user = await createUser();

      const response = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('X-Forwarded-For', '198.51.100.99')
        .send({ offerId })
        .expect(201);

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.body.id } });

      // Behind Caddy this is the only way the user's address reaches us at
      // all; without it every click records the proxy.
      expect(stored.ipAddress).toBe('198.51.100.99');
    });

    it('spends one client’s click allowance without touching another’s', async () => {
      /*
       * The property the whole IP chain exists to produce, and the one that
       * fails loudest when it collapses.
       *
       * `web` calls this endpoint server-side, so if it does not forward the
       * caller's address the API records the `web` container for every click on
       * the platform. `clicks.max_per_ip_per_hour` then stops being a per-client
       * ceiling and becomes a global one: once the platform makes N clicks in an
       * hour, the next user to click is refused for something a stranger did.
       * The same collapsed address feeds `fraud.rules.shared_ip_accounts`
       * (eight accounts on one address → HOLD), which would eventually hold
       * every conversion in the system.
       *
       * Two addresses, one ceiling each: A exhausts its own and B is untouched.
       */
      app.getHttpAdapter().getInstance().set('trust proxy', 1);

      await configuration.set(CLICKS_MAX_PER_IP_PER_HOUR.key, 1, {
        actor: { type: 'system' },
      });

      const clientA = '198.51.100.10';
      const clientB = '203.0.113.20';

      const first = await createUser();
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${first.token}`)
        .set('X-Forwarded-For', clientA)
        .send({ offerId })
        .expect(201);

      // A different account, so only the address can be what refuses it.
      const second = await createUser();
      const refused = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${second.token}`)
        .set('X-Forwarded-For', clientA)
        .send({ offerId })
        .expect(429);

      expect(refused.body.error.code).toBe(ERROR_CODES.CLICK_RATE_LIMIT_EXCEEDED);

      // …and a third client, whose bucket nobody has spent.
      const third = await createUser();
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${third.token}`)
        .set('X-Forwarded-For', clientB)
        .send({ offerId })
        .expect(201);
    });

    it('records the forwarded address as the fraud evidence, not the proxy', async () => {
      /*
       * `fraud` reads this row: `clickIp` for the geo comparison,
       * `accountsSharingIp` and the IP conversion-velocity rule for the rest. A
       * collapsed address makes all three describe the deployment rather than
       * the user, and they all fire in the direction of holding honest money.
       */
      app.getHttpAdapter().getInstance().set('trust proxy', 1);
      const user = await createUser();

      const response = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('X-Forwarded-For', '198.51.100.77')
        .send({ offerId })
        .expect(201);

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.body.id } });

      expect(stored.ipAddress).toBe('198.51.100.77');
      // Docker's bridge network, which is what a collapsed address looks like.
      expect(stored.ipAddress).not.toMatch(/^172\.\d+\.\d+\.\d+$/);
    });
  });

  describe('the caller reading their own clicks', () => {
    it('returns only their own, whatever they ask for', async () => {
      const mine = await createUser();
      const theirs = await createUser();

      for (const user of [mine, theirs]) {
        await request(server())
          .post('/clicks')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ offerId })
          .expect(201);
      }

      const response = await request(server())
        .get('/clicks/me')
        .set('Authorization', `Bearer ${mine.token}`)
        .expect(200);

      // Ownership is enforced in the service, not by a query parameter a
      // caller could change (§6.2).
      expect(response.body.total).toBe(1);
      expect(response.body.items[0].providerSlug).toBe('mock');
    });

    it('does not echo the fraud evidence back', async () => {
      const user = await createUser();
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('user-agent', 'Mozilla/5.0 (Secretive)')
        .send({ offerId, deviceFingerprint: 'fp-secret-000' })
        .expect(201);

      const response = await request(server())
        .get('/clicks/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('Secretive');
      expect(JSON.stringify(response.body)).not.toContain('fp-secret-000');
    });
  });

  describe('the admin surface', () => {
    it('refuses a regular user', async () => {
      const user = await createUser();
      const auth = { Authorization: `Bearer ${user.token}` };

      await request(server()).get('/admin/clicks').set(auth).expect(403);
      await request(server())
        .get('/admin/clicks/0192f0a0-0000-7000-8000-0000000000aa')
        .set(auth)
        .expect(403);
    });

    it('shows an investigator the evidence', async () => {
      const user = await createUser();
      const admin = await createUser('ADMIN');

      const created = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .set('user-agent', 'Mozilla/5.0 (Suspect)')
        .send({ offerId, deviceFingerprint: 'fp-suspect-01' })
        .expect(201);

      const response = await request(server())
        .get(`/admin/clicks/${created.body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.userId).toBe(user.id);
      expect(response.body.userAgent).toBe('Mozilla/5.0 (Suspect)');
      expect(response.body.deviceFingerprint).toBe('fp-suspect-01');
    });

    it('filters by user, and by the IP an investigation starts from', async () => {
      app.getHttpAdapter().getInstance().set('trust proxy', 1);
      const one = await createUser();
      const two = await createUser();
      const admin = await createUser('ADMIN');

      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${one.token}`)
        .set('X-Forwarded-For', '198.51.100.5')
        .send({ offerId })
        .expect(201);
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${two.token}`)
        .set('X-Forwarded-For', '198.51.100.5')
        .send({ offerId })
        .expect(201);

      const byIp = await request(server())
        .get('/admin/clicks?ipAddress=198.51.100.5')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // "Who else clicked from here?" is where a multi-accounting
      // investigation starts.
      expect(byIp.body.total).toBe(2);
      expect(new Set(byIp.body.items.map((i: { userId: string }) => i.userId)).size).toBe(2);

      const byUser = await request(server())
        .get(`/admin/clicks?userId=${one.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(byUser.body.total).toBe(1);
    });

    it('has no endpoint that can change or remove a click', async () => {
      const user = await createUser();
      const admin = await createUser('ADMIN');
      const created = await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId })
        .expect(201);

      const auth = { Authorization: `Bearer ${admin.token}` };

      /*
       * A click is the evidence behind every "I completed this and was not
       * paid" ticket. An admin who could rewrite one could rewrite what a
       * user was owed.
       */
      await request(server()).delete(`/admin/clicks/${created.body.id}`).set(auth).expect(404);
      await request(server())
        .patch(`/admin/clicks/${created.body.id}`)
        .set(auth)
        .send({ rewardPoints: 1 })
        .expect(404);
      await request(server()).delete(`/clicks/${created.body.id}`).set(auth).expect(404);
    });
  });
});
