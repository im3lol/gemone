import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ADMIN_ACTIONS, ERROR_CODES } from '@gemone/contracts';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { ProviderRegistry } from '../../src/modules/providers/registry/provider-registry';

/**
 * The provider administration surface, end to end.
 *
 * What is worth verifying here is not that an endpoint returns 200. It is
 * that a provider cannot be disabled by someone who is not an admin, that
 * disabling one and recording who did it either both happen or neither does,
 * and that the registry actually reflects the change — because a switch the
 * admin panel shows as "off" while the platform keeps calling the provider is
 * worse than no switch at all.
 */
describe('admin provider surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: ProviderRegistry;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `provider-admin-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    registry = app.get(ProviderRegistry);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // The catalog references providers, so it goes first — these tests
    // predate `offers` and would otherwise trip the foreign key on rows a
    // previous file left behind.
    // Clicks reference users, offers and providers, so they go first.
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
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.provider.deleteMany();

    // Rows are deleted behind the service's back, so the in-memory snapshot
    // has to be rebuilt — otherwise a test inherits the previous one's
    // registry and passes for the wrong reason.
    await app.get(ProvidersService).reload();
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

  async function createProvider(token: string) {
    const response = await request(server())
      .post('/admin/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'mock', displayName: 'Mock Offerwall' })
      .expect(201);

    return response.body;
  }

  describe('role-based authorization', () => {
    it('protects every provider endpoint, not just the listed one', async () => {
      const user = await createUser('USER');
      const auth = { Authorization: `Bearer ${user.token}` };
      const id = '0192f0a0-0000-7000-8000-0000000000aa';

      /*
       * `@Roles(ADMIN)` is declared on the controller precisely so a new
       * endpoint cannot be added without it. This test is what makes that
       * claim survive the next endpoint.
       */
      await request(server()).get('/admin/providers').set(auth).expect(403);
      await request(server()).get('/admin/providers/adapters').set(auth).expect(403);
      await request(server()).get(`/admin/providers/${id}`).set(auth).expect(403);
      await request(server())
        .post('/admin/providers')
        .set(auth)
        .send({ slug: 'mock', displayName: 'Mock' })
        .expect(403);
      await request(server())
        .patch(`/admin/providers/${id}`)
        .set(auth)
        .send({ displayName: 'Renamed' })
        .expect(403);
      await request(server())
        .patch(`/admin/providers/${id}/enabled`)
        .set(auth)
        .send({ enabled: false, reason: 'testing access control' })
        .expect(403);
      await request(server())
        .post(`/admin/providers/${id}/health/reset`)
        .set(auth)
        .send({ reason: 'testing access control' })
        .expect(403);
    });

    it('refuses an unauthenticated caller with 401', async () => {
      await request(server()).get('/admin/providers').expect(401);
    });
  });

  describe('capability discovery', () => {
    it('lists what the build supports before any provider row exists', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get('/admin/providers/adapters')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // The screen someone uses *before* adding a provider. Without it,
      // adding one means reading the source to find the adapter map.
      const mock = response.body.items.find((item: { slug: string }) => item.slug === 'mock');
      expect(mock.capabilities).toContain('reversals');
      expect(mock.requiredCredentialVariables).toContain('PROVIDER_MOCK_SECRET');
    });

    it('never returns a credential value', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .get('/admin/providers/adapters')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      // "Admin" is not a reason to serialise secrets (§19.3).
      expect(JSON.stringify(response.body)).not.toContain('mock-fixture-secret');
    });

    it('resolves /adapters as a route, not as a provider id', async () => {
      const admin = await createUser('ADMIN');

      // Route order matters: declared after `:id`, this would be parsed as a
      // provider id and rejected as a malformed UUID.
      await request(server())
        .get('/admin/providers/adapters')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });
  });

  describe('creating a provider', () => {
    it('creates it disabled and records who did it', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      expect(provider.isEnabled).toBe(false);
      expect(provider.adapterRegistered).toBe(true);

      const audit = await prisma.adminAuditLog.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.PROVIDER_CREATED);
      expect(audit[0]!.adminId).toBe(admin.id);
    });

    it('rejects a slug with no adapter, with a 422 and a usable message', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .post('/admin/providers')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ slug: 'no-such-network', displayName: 'Ghost' })
        .expect(422);

      expect(response.body.error.code).toBe(ERROR_CODES.PROVIDER_UNKNOWN_SLUG);
      expect(response.body.error.message).toContain('mock');
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('rejects a malformed IP range with 422 and writes nothing', async () => {
      const admin = await createUser('ADMIN');

      const response = await request(server())
        .post('/admin/providers')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ slug: 'mock', displayName: 'Mock', postbackIpRanges: ['garbage'] })
        .expect(422);

      expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(await prisma.provider.count()).toBe(0);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('rejects an unknown property rather than ignoring it', async () => {
      const admin = await createUser('ADMIN');

      // `isEnabled` is deliberately not part of the create contract. Silently
      // dropping it would let someone believe they had created an enabled
      // provider.
      await request(server())
        .post('/admin/providers')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ slug: 'mock', displayName: 'Mock', isEnabled: true })
        .expect(422);
    });
  });

  describe('enabling and disabling', () => {
    it('flips the switch, records the reason, and updates the registry', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      const response = await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: true, reason: 'contract signed, going live' })
        .expect(200);

      expect(response.body.isEnabled).toBe(true);

      // The switch is only real if the running process acts on it (§7.3).
      expect(registry.enabled().map((p) => p.slug)).toEqual(['mock']);

      const audit = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' } });
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.PROVIDER_ENABLED);
      expect(audit[0]!.reason).toBe('contract signed, going live');
      expect(audit[0]!.before).toEqual({ isEnabled: false });
      expect(audit[0]!.after).toEqual({ isEnabled: true });
    });

    it('makes a provider inert again, immediately', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);
      const auth = { Authorization: `Bearer ${admin.token}` };

      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set(auth)
        .send({ enabled: true, reason: 'going live now' })
        .expect(200);

      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set(auth)
        .send({ enabled: false, reason: 'sending malformed postbacks' })
        .expect(200);

      // "Cutting off a misbehaving provider takes seconds and no deploy",
      // which matters at 2 a.m. — and is only true if it takes effect here.
      expect(registry.enabled()).toEqual([]);
    });

    it('demands a reason', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      const response = await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: true })
        .expect(422);

      expect(response.body.error.fields[0].field).toBe('reason');
    });

    it('rejects a token reason', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      // "x" satisfies a required field without satisfying the requirement.
      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: true, reason: 'x' })
        .expect(422);
    });

    it('writes no audit entry when the transition is refused', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);
      await prisma.adminAuditLog.deleteMany();

      // Already disabled.
      await request(server())
        .patch(`/admin/providers/${provider.id}/enabled`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ enabled: false, reason: 'a redundant change' })
        .expect(409);

      // The transaction leaves no trace: an audit trail describing a change
      // that did not happen is worse than none.
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe('updating and listing', () => {
    it('records before and after on an update', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      const response = await request(server())
        .patch(`/admin/providers/${provider.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ displayName: 'Mock Offerwall (EU)', postbackIpRanges: ['203.0.113.0/24'] })
        .expect(200);

      expect(response.body.displayName).toBe('Mock Offerwall (EU)');
      expect(response.body.postbackIpRanges).toEqual(['203.0.113.0/24']);

      const audit = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' } });
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.PROVIDER_UPDATED);
      expect(audit[0]!.before).toMatchObject({ displayName: 'Mock Offerwall' });
    });

    it('has no delete endpoint', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      // A provider row is referenced by every conversion ever received
      // through it (DATABASE.md §7.2). "Removal" is `isEnabled = false`, so
      // history stays readable instead of pointing at nothing.
      await request(server())
        .delete(`/admin/providers/${provider.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404);
    });

    it('filters the list by enabled state', async () => {
      const admin = await createUser('ADMIN');
      const auth = { Authorization: `Bearer ${admin.token}` };
      await createProvider(admin.token);

      const disabled = await request(server())
        .get('/admin/providers?isEnabled=false')
        .set(auth)
        .expect(200);
      expect(disabled.body.items).toHaveLength(1);

      const enabled = await request(server())
        .get('/admin/providers?isEnabled=true')
        .set(auth)
        .expect(200);
      expect(enabled.body.items).toEqual([]);
    });

    it('rejects a malformed provider id with 422, not 400', async () => {
      const admin = await createUser('ADMIN');

      // One status for one class of problem: a client seeing 422 for a body
      // field and 400 for a path id learns two things about one mistake.
      await request(server())
        .get('/admin/providers/not-a-uuid')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(422);
    });
  });

  describe('health administration', () => {
    it('resets a failure streak and records why', async () => {
      const admin = await createUser('ADMIN');
      const provider = await createProvider(admin.token);

      await prisma.provider.update({
        where: { id: provider.id },
        data: { healthState: 'DOWN', consecutiveFailureCount: 14 },
      });

      const response = await request(server())
        .post(`/admin/providers/${provider.id}/health/reset`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'provider confirmed their API is back' })
        .expect(201);

      expect(response.body.healthState).toBe('HEALTHY');
      expect(response.body.consecutiveFailureCount).toBe(0);

      const audit = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' } });
      expect(audit[0]!.action).toBe(ADMIN_ACTIONS.PROVIDER_HEALTH_RESET);
      expect(audit[0]!.before).toMatchObject({ healthState: 'DOWN' });
    });
  });
});
