import { Test } from '@nestjs/testing';
import { ERROR_CODES, SYNC_MODES } from '@gemone/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { DomainError } from '../../src/core/errors/app-error';
import { ClicksService } from '../../src/modules/clicks/clicks.service';
import {
  CLICKS_ATTRIBUTION_WINDOW_DAYS,
  CLICKS_MAX_PER_IP_PER_HOUR,
  CLICKS_MAX_PER_USER_PER_HOUR,
} from '../../src/modules/clicks/clicks.config';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { OffersService } from '../../src/modules/offers/offers.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { UsersService } from '../../src/modules/users/users.service';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * Click tracking against a real Postgres — ARCHITECTURE.md §18.3.
 *
 * Driven through the real catalog: the offers clicked here were synced by the
 * mock provider through the production pipeline, so the snapshot, the redirect
 * URL and the provider resolution are all the code that runs in production.
 */
describe('click tracking (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let clicks: ClicksService;
  let offers: OffersService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let users: UsersService;
  let configuration: ConfigurationService;

  let providerId: string;
  let offerId: string;
  let userId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    clicks = moduleRef.get(ClicksService);
    offers = moduleRef.get(OffersService);
    providers = moduleRef.get(ProvidersService);
    catalog = moduleRef.get(CatalogSyncService);
    users = moduleRef.get(UsersService);
    configuration = moduleRef.get(ConfigurationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
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

    // The catalog is populated by the real sync, not by hand-written rows.
    await catalog.sync(providerId, SYNC_MODES.FULL);
    offerId = (await prisma.offer.findFirstOrThrow({ where: { externalId: 'MK-100241' } })).id;

    const user = await users.create({
      email: `clicker.${Date.now()}@example.com`,
      passwordHash: 'not-used-here',
    });
    userId = user.id;
  });

  const click = (overrides: Partial<Parameters<ClicksService['create']>[0]> = {}) =>
    clicks.create({ userId, offerId, ipAddress: '203.0.113.7', ...overrides });

  describe('the promise', () => {
    it('writes the row before returning a redirect', async () => {
      const response = await click();

      // PROJECT.md §4.3. A user sent to a provider with no click behind them
      // has done work nobody can credit — the provider will report against a
      // sub_id we never issued.
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });
      expect(stored.subId).toBe(response.subId);
      expect(response.redirectUrl).toContain(response.subId);
    });

    it('snapshots what the user was shown', async () => {
      const response = await click();
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      expect(stored.offerTitleSnapshot).toBe('Skyline Racer — reach level 12');
      expect(stored.rewardPointsSnapshot).toBe(171);
      expect(response.offerTitle).toBe(stored.offerTitleSnapshot);
    });

    it('keeps the snapshot when the offer changes underneath it', async () => {
      const response = await click();

      // Offers are overwritten by every sync. Re-price the offer as a rate
      // change would, then re-sync.
      await prisma.offer.update({
        where: { id: offerId },
        data: { title: 'Renamed campaign', rewardPoints: 5 },
      });

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      /*
       * The reason for denormalising three fields. Without this, a dispute two
       * weeks later cannot establish what was promised — and
       * promised-versus-paid is the most common support case on an offerwall.
       */
      expect(stored.offerTitleSnapshot).toBe('Skyline Racer — reach level 12');
      expect(stored.rewardPointsSnapshot).toBe(171);
    });

    it('captures the evidence taken at click time', async () => {
      const response = await click({
        userAgent: '  Mozilla/5.0 (Test)  ',
        deviceFingerprint: 'fp-abcdef123456',
        referrer: 'https://wall.test/offers',
      });

      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      expect(stored.ipAddress).toBe('203.0.113.7');
      expect(stored.userAgent).toBe('Mozilla/5.0 (Test)');
      expect(stored.deviceFingerprint).toBe('fp-abcdef123456');
      expect(stored.referrer).toBe('https://wall.test/offers');
    });
  });

  describe('the redirect URL', () => {
    it('is built by the provider adapter, from the offer template', async () => {
      const response = await click();

      // §19.3: redirect targets are built by adapters from configuration,
      // never assembled from user-supplied input.
      expect(response.redirectUrl).toMatch(/^https:\/\/track\.mock-offers\.test\/click\?/);
      expect(response.redirectUrl).toContain('cid=MK-100241');
      expect(response.redirectUrl).toContain('aff=AFF-TEST');
    });

    it('carries no user id — the provider gets an opaque reference at most', async () => {
      const response = await click();

      /*
       * PROJECT.md §4.3: the raw user id is never passed to a provider. This
       * mock's template happens not to include a user slot at all, which is
       * the stronger version of the same guarantee.
       */
      expect(response.redirectUrl).not.toContain(userId);
      expect(response.subId).not.toContain(userId);
    });

    it('is unique per click, even for the same user and offer', async () => {
      const first = await click();
      const second = await click();

      // Two clicks are two promises. Sharing a sub_id would make an incoming
      // conversion creditable to either with no way to tell which.
      expect(first.subId).not.toBe(second.subId);
      expect(await prisma.click.count()).toBe(2);
    });
  });

  describe('what refuses a click', () => {
    it('refuses an inactive offer', async () => {
      await offers.setActive(offerId, false);

      // The most common source of "I completed this and was not paid": the
      // campaign was over before the user started.
      await expect(click()).rejects.toThrow(DomainError);
      await expect(click()).rejects.toMatchObject({
        code: ERROR_CODES.CLICK_OFFER_UNAVAILABLE,
      });
      expect(await prisma.click.count()).toBe(0);
    });

    it('refuses a disabled provider', async () => {
      await providers.setEnabled(providerId, false);
      await providers.reload();

      // §7.3: a disabled provider is inert. Its postback endpoint rejects, so
      // a click made now could never be converted.
      await expect(click()).rejects.toMatchObject({ code: ERROR_CODES.PROVIDER_DISABLED });
      expect(await prisma.click.count()).toBe(0);
    });

    it('refuses an offer that does not exist', async () => {
      await expect(
        click({ offerId: '0192f0a0-0000-7000-8000-0000000000ff' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.OFFER_NOT_FOUND });
    });

    it('writes nothing when it refuses', async () => {
      await offers.setActive(offerId, false);
      await click().catch(() => undefined);

      // A refusal that left a click row would be a promise nobody made.
      expect(await prisma.click.count()).toBe(0);
    });
  });

  describe('the attribution window', () => {
    it('is stored on the click, resolved from configuration once', async () => {
      const response = await click();
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      const days =
        (stored.attributionExpiresAt.getTime() - stored.createdAt.getTime()) /
        (24 * 60 * 60 * 1000);

      expect(Math.round(days)).toBe(30);
    });

    it('honours a per-provider override — P3', async () => {
      await configuration.set(CLICKS_ATTRIBUTION_WINDOW_DAYS.key, 7, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'admin', id: '0192f0a0-0000-7000-8000-0000000000ad' },
      });

      // Networks differ in how long they take to report a conversion, so one
      // window across all of them is either too generous or too strict.
      const response = await click();
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      const days =
        (stored.attributionExpiresAt.getTime() - stored.createdAt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(Math.round(days)).toBe(7);
    });

    it('does NOT retroactively close a window a user was already promised', async () => {
      const response = await click();
      const before = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      await configuration.set(CLICKS_ATTRIBUTION_WINDOW_DAYS.key, 1, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'system' },
      });

      const after = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      /*
       * The whole reason the window is stored rather than computed
       * (ARCHITECTURE.md §9.4's reasoning). Resolving it at read time would
       * let an admin shortening the window invalidate clicks users had already
       * made — and every conversion still in flight for them.
       */
      expect(after.attributionExpiresAt).toEqual(before.attributionExpiresAt);
      expect(clicks.isExpired(after)).toBe(false);
    });
  });

  describe('resolving a sub_id back to a click', () => {
    it('resolves one we issued', async () => {
      const response = await click();
      const resolved = await clicks.resolveSubId(response.subId);

      expect(resolved.id).toBe(response.id);
      expect(resolved.userId).toBe(userId);
    });

    it('rejects a forged sub_id without touching the database', async () => {
      // The signature answers "was this ever one of ours" before any I/O, so
      // the public postback surface cannot be used to drive query load.
      await expect(clicks.resolveSubId('AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB'))
        .rejects.toMatchObject({ code: ERROR_CODES.CLICK_SUB_ID_INVALID });
    });

    it('distinguishes "never ours" from "ours but unknown"', async () => {
      const response = await click();
      await prisma.click.delete({ where: { id: response.id } });

      // §10.2 gives each a different postback response and a different
      // operator action: one is an attack, the other is a quarantine case.
      await expect(clicks.resolveSubId(response.subId)).rejects.toMatchObject({
        code: ERROR_CODES.CLICK_NOT_FOUND,
      });
    });

    it('refuses a click whose window has closed', async () => {
      const response = await click();
      await prisma.click.update({
        where: { id: response.id },
        data: { attributionExpiresAt: new Date(Date.now() - 1000) },
      });

      await expect(clicks.resolveSubId(response.subId)).rejects.toMatchObject({
        code: ERROR_CODES.CLICK_ATTRIBUTION_EXPIRED,
      });
    });

    it('enforces uniqueness at the database, not only in code', async () => {
      const response = await click();

      // Attribution has to be unambiguous (DATABASE.md §9.1), and a
      // constraint is the only place that survives a race.
      await expect(
        prisma.click.create({
          data: {
            id: '0192f0a0-0000-7000-8000-0000000000c1',
            userId,
            offerId,
            providerId,
            subId: response.subId,
            offerTitleSnapshot: 'duplicate',
            rewardPointsSnapshot: 1,
            attributionExpiresAt: new Date(Date.now() + 1000),
          },
        }),
      ).rejects.toThrow(/[Uu]nique/);
    });
  });

  describe('the click limit — a fraud control, not an HTTP throttle', () => {
    it('stops a user who exceeds the configured hourly ceiling', async () => {
      await configuration.set(CLICKS_MAX_PER_USER_PER_HOUR.key, 3, {
        actor: { type: 'admin', id: '0192f0a0-0000-7000-8000-0000000000ad' },
      });

      await click();
      await click();
      await click();

      /*
       * §19.5's third layer. A script clicking every offer on the wall in
       * sequence looks unremarkable to a rate limiter and burns a provider's
       * click budget — which is how an integration gets terminated.
       */
      await expect(click()).rejects.toMatchObject({
        code: ERROR_CODES.CLICK_RATE_LIMIT_EXCEEDED,
      });
      expect(await prisma.click.count()).toBe(3);
    });

    it('does not say which ceiling was hit', async () => {
      await configuration.set(CLICKS_MAX_PER_USER_PER_HOUR.key, 1, {
        actor: { type: 'system' },
      });
      await click();

      // Telling a caller which limit they hit tells them how to spread their
      // clicks to stay under it.
      const error = await click().catch((e: DomainError) => e);
      expect((error as DomainError).message).not.toMatch(/user|ip/i);
    });

    it('counts a rolling hour, not a calendar one', async () => {
      await configuration.set(CLICKS_MAX_PER_USER_PER_HOUR.key, 2, {
        actor: { type: 'system' },
      });
      await click();
      await click();
      await expect(click()).rejects.toThrow();

      // Age one click past the window; the ceiling frees up by exactly one.
      const oldest = await prisma.click.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
      await prisma.click.update({
        where: { id: oldest.id },
        data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      });

      await expect(click()).resolves.toBeDefined();
    });

    it('limits an IP across different users', async () => {
      await configuration.set(CLICKS_MAX_PER_IP_PER_HOUR.key, 2, {
        actor: { type: 'system' },
      });

      const second = await users.create({
        email: `second.${Date.now()}@example.com`,
        passwordHash: 'x',
      });

      await click();
      await click({ userId: second.id });

      /*
       * What the per-user limit cannot see: one actor spreading clicks across
       * many freshly registered accounts, which is the shape multi-accounting
       * takes.
       */
      await expect(click({ userId: second.id })).rejects.toMatchObject({
        code: ERROR_CODES.CLICK_RATE_LIMIT_EXCEEDED,
      });
    });

    it('does not group callers with no known address into one bucket', async () => {
      await configuration.set(CLICKS_MAX_PER_IP_PER_HOUR.key, 1, {
        actor: { type: 'system' },
      });

      // Otherwise one unidentified caller exhausts the limit for all of them.
      await expect(click({ ipAddress: null })).resolves.toBeDefined();
      await expect(click({ ipAddress: null })).resolves.toBeDefined();
    });
  });

  describe('reads', () => {
    it('scopes a user to their own clicks', async () => {
      const other = await users.create({
        email: `other.${Date.now()}@example.com`,
        passwordHash: 'x',
      });

      await click();
      await click({ userId: other.id });

      const mine = await clicks.findManyForUser(userId, {});
      expect(mine.total).toBe(1);
      expect(mine.items[0]!.userId).toBe(userId);
    });

    it("keeps the fraud evidence off the owner's view", async () => {
      const response = await click({ userAgent: 'Mozilla/5.0', deviceFingerprint: 'fp-123456' });
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      const summary = clicks.toSummary(stored, 'mock');

      /*
       * Captured *about* this user for fraud purposes. Echoing it back
       * confirms to anyone who has taken the account exactly which signals we
       * hold — and the account holder is who we are trying to protect.
       */
      expect(JSON.stringify(summary)).not.toContain('Mozilla');
      expect(JSON.stringify(summary)).not.toContain('fp-123456');
      expect(JSON.stringify(summary)).not.toContain('203.0.113.7');
    });

    it('gives an investigator the evidence', async () => {
      const response = await click({ userAgent: 'Mozilla/5.0', deviceFingerprint: 'fp-123456' });
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      const summary = clicks.toAdminSummary(stored, 'mock');

      expect(summary.ipAddress).toBe('203.0.113.7');
      expect(summary.userAgent).toBe('Mozilla/5.0');
      expect(summary.deviceFingerprint).toBe('fp-123456');
    });

    it('reports expiry as derived state', async () => {
      const response = await click();
      const stored = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      expect(clicks.toSummary(stored, 'mock').isExpired).toBe(false);

      await prisma.click.update({
        where: { id: response.id },
        data: { attributionExpiresAt: new Date(Date.now() - 1) },
      });
      const expired = await prisma.click.findUniqueOrThrow({ where: { id: response.id } });

      expect(clicks.toSummary(expired, 'mock').isExpired).toBe(true);
    });
  });

  describe('the click record outlives what it points at', () => {
    it('survives the offer being deactivated', async () => {
      const response = await click();
      await offers.setActive(offerId, false);

      // A click whose offer row vanished is an unanswerable support ticket
      // (DATABASE.md §7.2), which is why offers are deactivated, never deleted.
      await expect(
        prisma.click.findUniqueOrThrow({ where: { id: response.id } }),
      ).resolves.toBeDefined();
    });

    it('refuses to let an offer be deleted out from under it', async () => {
      await click();

      // `onDelete: Restrict`. The database enforces what the policy says.
      await expect(prisma.offer.delete({ where: { id: offerId } })).rejects.toThrow();
    });

    it('refuses to let the user be deleted', async () => {
      await click();

      // Users are anonymised, never deleted (DATABASE.md §7.3).
      await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow();
    });
  });

  describe('configuration inventory', () => {
    it('registers exactly the keys the application owns', () => {
      const keys = configuration
        .definitionsList()
        .map((definition) => definition.key)
        .filter((key) => !key.startsWith('test.'))
        .sort();

      expect(keys).toEqual([
        'auth.email_verification_ttl_seconds',
        'auth.login_account_window_seconds',
        'auth.login_ip_window_seconds',
        'auth.login_max_failures_per_account',
        'auth.login_max_failures_per_ip',
        'auth.password_reset_ttl_seconds',
        'auth.public_ip_window_seconds',
        'auth.public_max_requests_per_ip',
        'clicks.attribution_window_days',
        'clicks.max_per_ip_per_hour',
        'clicks.max_per_user_per_hour',
        'fraud.chargeback_minimum_conversions',
        'fraud.disposable_email_domains',
        'fraud.enabled',
        'fraud.rules.chargeback_rate',
        'fraud.rules.disposable_email',
        'fraud.rules.impossible_timing',
        'fraud.rules.ip_conversion_velocity',
        'fraud.rules.shared_device_accounts',
        'fraud.rules.shared_ip_accounts',
        'fraud.rules.user_conversion_velocity',
        'fraud.shared_identity_window_days',
        'fraud.velocity_window_minutes',
        'offers.accounting_currency',
        'offers.points_per_minor_unit',
        'offers.reward_share_percent',
        'offers.sync.full_sync_interval_hours',
        'offers.sync.prune_safety_threshold_percent',
        'payouts.currency',
        'payouts.enabled_methods',
        'payouts.max_requests_per_day',
        'payouts.maximum_points',
        'payouts.minimum_points',
        'payouts.points_per_currency_unit',
        'providers.health.degraded_after_failures',
        'providers.health.down_after_failures',
        'rewards.hold_period_days',
      ]);
    });
  });
});
