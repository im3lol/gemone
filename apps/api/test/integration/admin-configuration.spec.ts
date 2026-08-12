import {
  ADMIN_ACTIONS,
  CONFIG_SCOPES,
  CONFIG_SOURCES,
  ERROR_CODES,
} from '@gemone/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { CLICKS_ATTRIBUTION_WINDOW_DAYS } from '../../src/modules/clicks/clicks.config';
import { PAYOUTS_ENABLED_METHODS } from '../../src/modules/payouts/payouts.config';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { FRAUD_RULE_USER_CONVERSION_VELOCITY } from '../../src/modules/fraud/fraud.config';
import { REWARDS_HOLD_PERIOD_DAYS } from '../../src/modules/rewards/rewards.config';
import { Prisma } from '../../src/generated/prisma/client';

/**
 * Configuration management, end to end — P3's second half.
 *
 * The store, the typing, the validation and the history have all been tested
 * since Feature 4. What is new, and what this file is about, is that an **admin
 * with a browser** can now reach them: that a change takes effect on the next
 * business read without a deploy, that it cannot be made by someone who is not
 * an admin, that it cannot invent a key or store a value of the wrong shape,
 * and that every change leaves both records DATABASE.md §3.7 asks for.
 */
describe('admin configuration surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configuration: ConfigurationService;
  let providers: ProvidersService;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `config-admin-${++counter}.${Date.now()}@example.com`;

  let providerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    configuration = app.get(ConfigurationService);
    providers = app.get(ProvidersService);
  });

  afterAll(async () => {
    await app?.close();
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

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.reload();
  });

  // --- Reading -------------------------------------------------------------

  describe('the key list', () => {
    it('lists every registered key, including ones nobody has ever set', async () => {
      /*
       * From the registry, not from the table. A list built from stored rows
       * would show nothing on a fresh install — hiding exactly the settings an
       * admin most needs to find, because unset is the normal state.
       */
      const admin = await createAdmin();

      const response = await get(admin, '/admin/configuration').expect(200);

      expect(response.body.total).toBeGreaterThan(25);
      expect(response.body.items.every((item: { source: string }) => item.source === 'default'))
        .toBe(true);
    });

    it('carries what an admin needs to change a value safely', async () => {
      const admin = await createAdmin();

      const response = await get(admin, '/admin/configuration').expect(200);
      const key = response.body.items.find(
        (item: { key: string }) => item.key === REWARDS_HOLD_PERIOD_DAYS.key,
      );

      // The default, the value in force, where it came from, what shape it
      // must be, and which scopes accept it. §4.9: configuration nobody can
      // read confidently is configuration nobody will change safely.
      expect(key).toMatchObject({
        description: expect.any(String),
        valueType: 'number',
        defaultValue: REWARDS_HOLD_PERIOD_DAYS.defaultValue,
        effectiveValue: REWARDS_HOLD_PERIOD_DAYS.defaultValue,
        source: CONFIG_SOURCES.DEFAULT,
        overrideCount: 0,
      });
      expect(key.scopes).toContain(CONFIG_SCOPES.GLOBAL);
    });

    it('never exposes a secret, because secrets are not configuration', async () => {
      /*
       * ARCHITECTURE.md §5.1 draws the line: credentials are environment,
       * business rules are configuration. This endpoint returns every
       * registered key, so if that line were ever crossed this is where it
       * would show — one screen listing every provider's API secret.
       */
      const admin = await createAdmin();
      const response = await get(admin, '/admin/configuration').expect(200);

      /*
       * The word scan runs over the **values**, not the whole document.
       *
       * It used to run over everything, and Feature 19 tripped it on
       * `auth.password_reset_ttl_seconds` — a number whose name says what it
       * configures. Names and descriptions are English written by us; a
       * credential can only arrive here as a *value*, so that is where the
       * scan belongs. Narrowing it this way loses nothing: no wording of a key
       * name has ever been what stops a secret being registered.
       */
      const values = JSON.stringify(
        response.body.items.map((item: { defaultValue: unknown; effectiveValue: unknown }) => [
          item.defaultValue,
          item.effectiveValue,
        ]),
      ).toLowerCase();

      expect(values).not.toContain('secret');
      expect(values).not.toContain('password');

      // The real one, over the whole document — the check that would catch a
      // leak regardless of what anything was named.
      const serialised = JSON.stringify(response.body).toLowerCase();
      expect(serialised).not.toContain(process.env.JWT_SECRET?.toLowerCase() ?? '@@absent@@');
    });

    it('searches by key and by description', async () => {
      const admin = await createAdmin();

      const byKey = await get(admin, '/admin/configuration?search=hold_period').expect(200);
      expect(byKey.body.items).toHaveLength(1);
      expect(byKey.body.items[0].key).toBe(REWARDS_HOLD_PERIOD_DAYS.key);

      // An admin looking for a concept should not have to know the spelling.
      const byDescription = await get(admin, '/admin/configuration?search=withdrawal').expect(
        200,
      );
      expect(byDescription.body.items.length).toBeGreaterThan(0);
    });

    it('can show only the keys somebody has changed', async () => {
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'shorter hold' });

      const response = await get(admin, '/admin/configuration?overriddenOnly=true').expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].key).toBe(REWARDS_HOLD_PERIOD_DAYS.key);
    });
  });

  describe('a key in detail', () => {
    it('404s for a key nobody registered', async () => {
      /*
       * §5.2's boundary at the edge. A caller cannot invent a key — the store
       * is typed because every key is declared by the module owning the rule,
       * and an API accepting arbitrary keys turns it back into a settings bag.
       */
      const admin = await createAdmin();

      const response = await get(admin, '/admin/configuration/not.a.real.key').expect(404);
      expect(response.body.error.code).toBe(ERROR_CODES.CONFIG_UNKNOWN_KEY);
    });

    it('shows every explicit setting alongside the default', async () => {
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global change' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 7,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'this network settles fast',
      });

      const response = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}`,
      ).expect(200);

      expect(response.body.overrides).toHaveLength(2);
      expect(response.body.overrides).toContainEqual(
        expect.objectContaining({ scope: CONFIG_SCOPES.GLOBAL, value: 21 }),
      );
      expect(response.body.overrides).toContainEqual(
        expect.objectContaining({
          scope: CONFIG_SCOPES.PROVIDER,
          scopeId: providerId,
          value: 7,
        }),
      );
      expect(response.body.defaultValue).toBe(REWARDS_HOLD_PERIOD_DAYS.defaultValue);
    });

    it('answers the effective-value question for one provider', async () => {
      /*
       * The chain, resolved for the admin rather than in their head:
       * PROVIDER → GLOBAL → default (§4.9). An admin editing a provider
       * override needs to know what that provider gets *today*.
       */
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global' });

      const inherited = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}?scopeId=${providerId}`,
      ).expect(200);

      expect(inherited.body.resolvedForScope).toEqual({
        scopeId: providerId,
        value: 21,
        source: CONFIG_SOURCES.GLOBAL,
      });

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'override it',
      });

      const overridden = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}?scopeId=${providerId}`,
      ).expect(200);

      expect(overridden.body.resolvedForScope).toEqual({
        scopeId: providerId,
        value: 3,
        source: CONFIG_SOURCES.PROVIDER,
      });

      // And the global value is untouched by the override.
      expect(overridden.body.effectiveValue).toBe(21);
    });
  });

  // --- Writing -------------------------------------------------------------

  describe('setting a value', () => {
    it('takes effect on the next business read, with no deploy and no restart', async () => {
      /*
       * **The feature, in one assertion.** PROJECT.md §3.2: an admin can adjust
       * these "without a developer". Everything else in this file is a
       * safeguard around this line.
       */
      const admin = await createAdmin();

      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 21,
        reason: 'chargebacks are arriving later than we assumed',
      }).expect(200);

      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(21);
    });

    it('stores a JSON-valued key as a structure, not a string', async () => {
      // `payouts.enabled_methods` is a list. A surface that stringified it
      // would pass every test that only checked the value came back.
      const admin = await createAdmin();

      await set(admin, PAYOUTS_ENABLED_METHODS.key, {
        value: ['paypal', 'bank_transfer'],
        reason: 'adding bank transfer for the pilot',
      }).expect(200);

      expect(await configuration.get(PAYOUTS_ENABLED_METHODS.key)).toEqual([
        'paypal',
        'bank_transfer',
      ]);
    });

    it('refuses a value of the wrong shape, and stores nothing', async () => {
      const admin = await createAdmin();

      const response = await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 'twenty-one',
        reason: 'a mistake',
      }).expect(422);

      expect(response.body.error.code).toBe(ERROR_CODES.CONFIG_INVALID_VALUE);

      // Nothing partially applied: no row, no history, and the value in force
      // is still the default.
      expect(await prisma.configurationValue.count()).toBe(0);
      expect(await prisma.configurationHistory.count()).toBe(0);
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });

    it('refuses a value outside the key’s own bounds', async () => {
      // Validation is the key's, not the API's — the schema registered with
      // the key is the only thing that knows a hold period has a ceiling.
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 100_000,
        reason: 'far too long',
      }).expect(422);
    });

    it('refuses a key it does not know', async () => {
      const admin = await createAdmin();

      const response = await set(admin, 'invented.key', { value: 1, reason: 'nope' }).expect(
        404,
      );

      expect(response.body.error.code).toBe(ERROR_CODES.CONFIG_UNKNOWN_KEY);
      expect(await prisma.configurationValue.count()).toBe(0);
    });

    it('demands a reason', async () => {
      /*
       * The one part of the record a person writes. A configuration change
       * alters economics with no deployment and no code review behind it, so
       * "why" is the only context a future reader gets.
       */
      const admin = await createAdmin();

      const response = await request(app.getHttpServer())
        .put(`/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ value: 21 })
        .expect(422);

      expect(response.body.error.fields).toContainEqual(
        expect.objectContaining({ field: 'reason' }),
      );
      expect(await prisma.configurationValue.count()).toBe(0);
    });

    it('accepts false and zero, which a naive emptiness check would reject', async () => {
      // `@IsNotEmpty` on `value` would refuse both, and both are legitimate.
      const admin = await createAdmin();

      await set(admin, 'fraud.enabled', { value: false, reason: 'incident: scoring is wrong' })
        .expect(200);

      expect(await configuration.get('fraud.enabled')).toBe(false);
    });
  });

  describe('scope validation', () => {
    it('refuses a provider override for a key that is global-only', async () => {
      /*
       * §4.9: "A key that is meaningless per provider must not be settable per
       * provider, or the resolution chain silently returns a value nobody
       * intended." A withdrawal minimum is about a balance, and by then the
       * points have no provider attached to them.
       */
      const admin = await createAdmin();

      const response = await set(admin, PAYOUTS_ENABLED_METHODS.key, {
        value: ['paypal'],
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'should not be allowed',
      }).expect(422);

      expect(response.body.error.code).toBe(ERROR_CODES.CONFIG_INVALID_SCOPE);
    });

    it('refuses a provider scope with no provider named', async () => {
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 7,
        scope: CONFIG_SCOPES.PROVIDER,
        reason: 'which provider?',
      }).expect(422);
    });

    it('refuses an override for a provider that does not exist', async () => {
      /*
       * A typo here writes a row that resolves for nobody — an override that
       * silently never applies, which on screen is indistinguishable from one
       * that does.
       */
      const admin = await createAdmin();

      const response = await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 7,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: '0192f0a0-0000-7000-8000-00000000dead',
        reason: 'ghost provider',
      }).expect(404);

      expect(response.body.error.code).toBe(ERROR_CODES.PROVIDER_NOT_FOUND);
      expect(await prisma.configurationValue.count()).toBe(0);
    });

    it('refuses a scope id on a global write', async () => {
      // Accepting and ignoring it would let an admin believe they had scoped a
      // change they had actually made everywhere.
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 7,
        scopeId: providerId,
        reason: 'ambiguous',
      }).expect(422);
    });

    it('keeps a provider override from leaking into the global value', async () => {
      const admin = await createAdmin();

      await set(admin, CLICKS_ATTRIBUTION_WINDOW_DAYS.key, {
        value: 7,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'short window for this network',
      }).expect(200);

      expect(await configuration.get(CLICKS_ATTRIBUTION_WINDOW_DAYS.key)).toBe(
        CLICKS_ATTRIBUTION_WINDOW_DAYS.defaultValue,
      );
      expect(await configuration.get(CLICKS_ATTRIBUTION_WINDOW_DAYS.key, providerId)).toBe(7);
    });
  });

  // --- Resetting -----------------------------------------------------------

  describe('resetting to the chain', () => {
    it('removes a global value and returns the key to its default', async () => {
      /*
       * The half of CRUD the service never had. Without it a value could be
       * changed but never unset, so a hold period set once could never go back
       * to the value code declares.
       */
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'change it' });
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(21);

      const response = await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        reason: 'the experiment is over',
      }).expect(200);

      expect(response.body.source).toBe(CONFIG_SOURCES.DEFAULT);
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
      expect(await prisma.configurationValue.count()).toBe(0);
    });

    it('removes a provider override and falls back to the global value', async () => {
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'override',
      });

      await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'back to the shared value',
      }).expect(200);

      // The chain, not the default: GLOBAL is still set.
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key, providerId)).toBe(21);
      expect(await prisma.configurationValue.count()).toBe(1);
    });

    it('is a no-op when nothing was stored, and records nothing', async () => {
      /*
       * "Use the default" is already true. Failing would make the reset button
       * depend on a state the admin cannot see, and auditing a change that did
       * not happen is noise in the one log that has to stay readable.
       */
      const admin = await createAdmin();

      await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'nothing to undo' }).expect(
        200,
      );

      expect(await prisma.configurationHistory.count()).toBe(0);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  // --- The record ----------------------------------------------------------

  describe('what a change leaves behind', () => {
    it('writes both records DATABASE.md §3.7 asks for', async () => {
      /*
       * Two trails, deliberately separate: `configuration_history` is the
       * per-key timeline and captures migrations and scripts too;
       * `admin_audit_log` is the per-admin index. Neither answers the other's
       * question.
       */
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 21,
        reason: 'chargebacks arriving later than assumed',
      }).expect(200);

      const history = await prisma.configurationHistory.findMany();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        key: REWARDS_HOLD_PERIOD_DAYS.key,
        scopeType: CONFIG_SCOPES.GLOBAL,
        oldValue: null,
        newValue: 21,
        actorType: 'admin',
        actorId: admin.id,
        reason: 'chargebacks arriving later than assumed',
      });

      const audit = await prisma.adminAuditLog.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        adminId: admin.id,
        action: ADMIN_ACTIONS.CONFIGURATION_CHANGED,
        targetType: 'configuration',
        targetId: `${REWARDS_HOLD_PERIOD_DAYS.key}@GLOBAL`,
        reason: 'chargebacks arriving later than assumed',
      });
    });

    it('names the scope on every history entry', async () => {
      /*
       * A key with a global value and a provider override produces one
       * timeline covering both. Without the scope on each row, "changed from
       * 30 to 60" is unreadable — there is no way to tell which of them moved.
       */
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'provider',
      });

      const response = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}/history`,
      ).expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.map((entry: { scope: string }) => entry.scope).sort()).toEqual([
        'GLOBAL',
        'PROVIDER',
      ]);
      expect(
        response.body.find((entry: { scope: string }) => entry.scope === 'PROVIDER').scopeId,
      ).toBe(providerId);
    });

    it('records a removal as a null new value, distinct from any value', async () => {
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'set' });
      await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'undo' });

      const response = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}/history`,
      ).expect(200);

      // Newest first. "Returned to the chain" is a different fact from any
      // number it could have been set to.
      expect(response.body[0]).toMatchObject({ oldValue: 21, newValue: null, reason: 'undo' });
      expect(response.body[1]).toMatchObject({ oldValue: null, newValue: 21 });
    });

    it('keeps the timeline across changes, so a value can be explained later', async () => {
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'first change' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 30, reason: 'second change' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 10, reason: 'third change' });

      const response = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}/history`,
      ).expect(200);

      expect(response.body.map((entry: { newValue: number }) => entry.newValue)).toEqual([
        10, 30, 21,
      ]);
      expect(response.body[0].oldValue).toBe(30);
    });

    it('filters the timeline to one scope', async () => {
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global' });
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'provider',
      });

      const response = await get(
        admin,
        `/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}/history?scope=PROVIDER`,
      ).expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].reason).toBe('provider');
    });
  });

  // --- The two blockers found in review ------------------------------------

  describe('concurrent resets', () => {
    it('lets one through and answers the loser cleanly, never with a 500', async () => {
      /*
       * A double-clicked reset button. The first version checked the cache for
       * "is anything stored?" and then called `delete`: both requests saw a
       * value, both deleted, and the loser hit Prisma's record-not-found,
       * which nothing caught and which reached the admin as a 500.
       *
       * `deleteMany` inside the transaction reports a count instead of
       * throwing, so the loser resolves into an ordinary no-op.
       */
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'set it' }).expect(200);

      const results = await Promise.all([
        reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'first' }),
        reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'second' }),
      ]);

      expect(results.map((response) => response.status)).toEqual([200, 200]);
      expect(results.every((response) => response.body.source === 'default')).toBe(true);
    });

    it('removes the row once and records exactly one removal', async () => {
      // Two history rows for one removal would make the timeline claim the
      // value was deleted twice, and two audit entries would double-count the
      // action in the per-admin index.
      const admin = await createAdmin();
      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'set it' }).expect(200);

      await Promise.all([
        reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'first' }),
        reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'second' }),
      ]);

      expect(await prisma.configurationValue.count()).toBe(0);

      const removals = await prisma.configurationHistory.findMany({
        where: { newValue: { equals: Prisma.DbNull } },
      });
      expect(removals).toHaveLength(1);

      // One for the set, one for the removal that happened.
      expect(await prisma.adminAuditLog.count()).toBe(2);
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });

    it('resets a row this process never cached', async () => {
      /*
       * The other direction of the same bug. The cache check could also be
       * stale the other way — "nothing stored" for a row written by another
       * process — and the reset would silently do nothing while answering 200.
       *
       * Written directly to the table so this process has never seen it.
       */
      const admin = await createAdmin();
      await prisma.configurationValue.create({
        data: {
          id: '0192f0a0-0000-7000-8000-0000000000e1',
          key: REWARDS_HOLD_PERIOD_DAYS.key,
          scopeType: CONFIG_SCOPES.GLOBAL,
          scopeId: '',
          value: 40,
          valueType: 'number',
          updatedBy: 'another-process',
        },
      });

      await reset(admin, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'remove it' }).expect(200);

      expect(await prisma.configurationValue.count()).toBe(0);
      // And it was recorded as a real removal, with what was actually there.
      const removal = await prisma.configurationHistory.findFirstOrThrow();
      expect(removal.oldValue).toBe(40);
    });
  });

  describe('a stored value that no longer satisfies its schema', () => {
    /** Writes a row straight to the table, as an older release would have. */
    async function storeMalformed(scopeType: string, scopeId: string, value: unknown) {
      await prisma.configurationValue.create({
        data: {
          id: `0192f0a0-0000-7000-8000-0000000000${scopeId ? 'f2' : 'f1'}`,
          key: FRAUD_RULE_USER_CONVERSION_VELOCITY.key,
          scopeType: scopeType as never,
          scopeId,
          value: value as never,
          valueType: 'json',
          updatedBy: 'migration',
        },
      });
      configuration.invalidateAll();
    }

    it('is ignored, and the default is served instead', async () => {
      /*
       * §14.4: "A stale shape from a previous deploy is treated as a miss."
       *
       * The failure this prevents is specific and silent. A fraud rule stored
       * under an older shape — no `weight`, no `action` — produced a `NaN`
       * score, which Postgres refuses on an integer column, failing the
       * conversion job and eventually costing a user their credit; and it
       * reported `ALLOW` for a rule that had fired, because an undefined
       * action compares as less severe than every real one.
       */
      await storeMalformed(CONFIG_SCOPES.GLOBAL, '', { enabled: true, threshold: 5 });

      const served = await configuration.get(FRAUD_RULE_USER_CONVERSION_VELOCITY.key);

      expect(served).toEqual(FRAUD_RULE_USER_CONVERSION_VELOCITY.defaultValue);
      expect(FRAUD_RULE_USER_CONVERSION_VELOCITY.schema.safeParse(served).success).toBe(true);
    });

    it('falls through to the next level of the chain, not straight to the default', async () => {
      // A bad PROVIDER row must yield the GLOBAL value. Skipping to the
      // default would discard a perfectly good setting somebody made.
      const admin = await createAdmin();
      await set(admin, FRAUD_RULE_USER_CONVERSION_VELOCITY.key, {
        value: { enabled: true, threshold: 4, weight: 10, action: 'HOLD' },
        reason: 'global',
      }).expect(200);

      await storeMalformed(CONFIG_SCOPES.PROVIDER, providerId, { enabled: true, threshold: 9 });

      expect(
        await configuration.get(FRAUD_RULE_USER_CONVERSION_VELOCITY.key, providerId),
      ).toMatchObject({ threshold: 4 });
    });

    it('still shows the row to an admin, flagged as not in use', async () => {
      /*
       * The fallback must not be silent on the screen either. Without the
       * flag the detail view would list a live-looking override beside an
       * effective value that came from somewhere else — two facts that
       * contradict each other, with nothing saying which is true.
       */
      const admin = await createAdmin();
      await storeMalformed(CONFIG_SCOPES.GLOBAL, '', { enabled: true, threshold: 5 });

      const response = await get(
        admin,
        `/admin/configuration/${FRAUD_RULE_USER_CONVERSION_VELOCITY.key}`,
      ).expect(200);

      expect(response.body.overrides).toHaveLength(1);
      expect(response.body.overrides[0]).toMatchObject({ valid: false, value: { threshold: 5 } });
      expect(response.body.source).toBe(CONFIG_SOURCES.DEFAULT);
    });

    it('is repaired by writing a valid value over it', async () => {
      // The way out has to work: a valid write replaces the row and the chain
      // starts using it again.
      const admin = await createAdmin();
      await storeMalformed(CONFIG_SCOPES.GLOBAL, '', { enabled: true, threshold: 5 });

      const repaired = { enabled: true, threshold: 6, weight: 20, action: 'HOLD' };
      await set(admin, FRAUD_RULE_USER_CONVERSION_VELOCITY.key, {
        value: repaired,
        reason: 'repairing a value left by an older release',
      }).expect(200);

      expect(await configuration.get(FRAUD_RULE_USER_CONVERSION_VELOCITY.key)).toEqual(repaired);
    });

    it('records what was actually stored when it is replaced, not the default', async () => {
      // The history row must say what was really there, or the trail loses the
      // evidence that a malformed value ever existed.
      const admin = await createAdmin();
      await storeMalformed(CONFIG_SCOPES.GLOBAL, '', { enabled: true, threshold: 5 });

      await set(admin, FRAUD_RULE_USER_CONVERSION_VELOCITY.key, {
        value: { enabled: true, threshold: 6, weight: 20, action: 'HOLD' },
        reason: 'repair',
      }).expect(200);

      const entry = await prisma.configurationHistory.findFirstOrThrow();
      expect(entry.oldValue).toEqual({ enabled: true, threshold: 5 });
    });
  });

  // --- Authorization -------------------------------------------------------

  describe('who may change a business rule', () => {
    it('refuses an ordinary user', async () => {
      /*
       * These endpoints move economics. A user who could reach them could set
       * their own reward share, their own withdrawal minimum, and turn fraud
       * scoring off.
       */
      const user = await createUser();

      await get(user, '/admin/configuration').expect(403);
      await set(user, REWARDS_HOLD_PERIOD_DAYS.key, { value: 1, reason: 'mine now' }).expect(
        403,
      );
      await reset(user, REWARDS_HOLD_PERIOD_DAYS.key, { reason: 'mine now' }).expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/admin/configuration').expect(401);
      await request(app.getHttpServer())
        .put(`/admin/configuration/${REWARDS_HOLD_PERIOD_DAYS.key}`)
        .send({ value: 1, reason: 'anonymous' })
        .expect(401);
    });

    it('changes nothing when it refuses', async () => {
      const user = await createUser();

      await set(user, REWARDS_HOLD_PERIOD_DAYS.key, { value: 1, reason: 'mine now' }).expect(
        403,
      );

      expect(await prisma.configurationValue.count()).toBe(0);
      expect(await prisma.configurationHistory.count()).toBe(0);
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });

    it('stops working the moment the admin role is taken away', async () => {
      const admin = await createAdmin();
      await get(admin, '/admin/configuration').expect(200);

      await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } });

      // The token is still valid and still says ADMIN; authorization is
      // re-checked against the row, not trusted from the claim.
      await get(admin, '/admin/configuration').expect(403);
    });
  });

  // --- Live reload ---------------------------------------------------------

  describe('live reload', () => {
    it('a business rule reads the new value immediately after the write returns', async () => {
      /*
       * Immediately, not eventually. The write invalidates the in-process
       * cache after committing (D51), so the very next read goes to the
       * database — there is no window where the API has acknowledged a change
       * it is not yet applying.
       */
      const admin = await createAdmin();

      await set(admin, CLICKS_ATTRIBUTION_WINDOW_DAYS.key, {
        value: 45,
        reason: 'longer window',
      }).expect(200);

      expect(await configuration.get(CLICKS_ATTRIBUTION_WINDOW_DAYS.key)).toBe(45);
    });

    it('re-reads after a reset too, not just after a write', async () => {
      // The cache is keyed by (key, scope, scopeId); a reset deletes the row
      // for that exact triple, and a stale entry would keep serving a value
      // whose row is gone.
      const admin = await createAdmin();

      await set(admin, CLICKS_ATTRIBUTION_WINDOW_DAYS.key, { value: 45, reason: 'set' });
      expect(await configuration.get(CLICKS_ATTRIBUTION_WINDOW_DAYS.key)).toBe(45);

      await reset(admin, CLICKS_ATTRIBUTION_WINDOW_DAYS.key, { reason: 'undo' }).expect(200);

      expect(await configuration.get(CLICKS_ATTRIBUTION_WINDOW_DAYS.key)).toBe(
        CLICKS_ATTRIBUTION_WINDOW_DAYS.defaultValue,
      );
    });

    it('invalidates the provider entry without disturbing the global one', async () => {
      const admin = await createAdmin();

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, { value: 21, reason: 'global' });
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key, providerId)).toBe(21);

      await set(admin, REWARDS_HOLD_PERIOD_DAYS.key, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'override',
      }).expect(200);

      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key, providerId)).toBe(3);
      expect(await configuration.get(REWARDS_HOLD_PERIOD_DAYS.key)).toBe(21);
    });
  });


  // --- Concurrency ---------------------------------------------------------

  /**
   * Two administrators, one key — TODO T88.
   *
   * A configuration change alters economics with no deployment behind it, and
   * the screen is read-modify-write: load a key, think, submit. Without a
   * precondition the later submission wins and neither operator is told.
   *
   * The token is the stored row's `updatedAt`, which the detail response has
   * always carried. These tests use it exactly as the screen does.
   */
  describe('concurrent writes', () => {
    const KEY = REWARDS_HOLD_PERIOD_DAYS.key;

    /** The `updatedAt` of the GLOBAL row, or null when nothing is stored. */
    async function versionOf(caller: Caller, key: string): Promise<string | null> {
      const response = await get(caller, `/admin/configuration/${key}`).expect(200);
      const global = (response.body.overrides as { scope: string; updatedAt: string }[]).find(
        (row) => row.scope === CONFIG_SCOPES.GLOBAL,
      );

      return global?.updatedAt ?? null;
    }

    it('accepts a write from someone who read the current value', async () => {
      const admin = await createAdmin();

      // Nothing stored yet, so the version an operator read is "absent".
      expect(await versionOf(admin, KEY)).toBeNull();

      await set(admin, KEY, { value: 21, reason: 'first write against a default', expectedUpdatedAt: null })
        .expect(200);

      const after = await versionOf(admin, KEY);
      expect(after).not.toBeNull();

      await set(admin, KEY, { value: 30, reason: 'second write, from the current value', expectedUpdatedAt: after })
        .expect(200);

      await expect(configuration.get(KEY)).resolves.toBe(30);
    });

    it('refuses a write from someone who read an older value', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the value A read', expectedUpdatedAt: null }).expect(200);
      const readByA = await versionOf(admin, KEY);

      // B changes it while A is thinking.
      await set(admin, KEY, { value: 45, reason: 'B changes it meanwhile', expectedUpdatedAt: readByA })
        .expect(200);

      const stale = await set(admin, KEY, {
        value: 30,
        reason: 'A submits the value they loaded',
        expectedUpdatedAt: readByA,
      }).expect(409);

      expect(stale.body.error.code).toBe(ERROR_CODES.CONFIG_STALE_WRITE);
      expect(stale.body.error.message).toMatch(/changed by someone else/i);

      // B's value survives. That is the whole point.
      await expect(configuration.get(KEY)).resolves.toBe(45);
    });

    it('refuses a first write when somebody else got there first', async () => {
      const admin = await createAdmin();

      // Both operators loaded a key with nothing stored.
      await set(admin, KEY, { value: 21, reason: 'the other operator, first', expectedUpdatedAt: null })
        .expect(200);

      const stale = await set(admin, KEY, {
        value: 30,
        reason: 'still believes nothing is stored',
        expectedUpdatedAt: null,
      }).expect(409);

      expect(stale.body.error.code).toBe(ERROR_CODES.CONFIG_STALE_WRITE);
      await expect(configuration.get(KEY)).resolves.toBe(21);
    });

    it('lets exactly one of two simultaneous writes win', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the value both operators read', expectedUpdatedAt: null })
        .expect(200);
      const shared = await versionOf(admin, KEY);

      /*
       * Sent together, not one after the other. Without the row lock inside
       * the write transaction both would read the same `updated_at`, both
       * would pass the check, and both would upsert — which is the race the
       * precondition alone cannot close.
       */
      const [first, second] = await Promise.all([
        set(admin, KEY, { value: 30, reason: 'operator one, at the same moment', expectedUpdatedAt: shared }),
        set(admin, KEY, { value: 60, reason: 'operator two, at the same moment', expectedUpdatedAt: shared }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const winner = first.status === 200 ? 30 : 60;
      await expect(configuration.get(KEY)).resolves.toBe(winner);

      // And the loser changed nothing at all.
      const history = await prisma.configurationHistory.findMany({ where: { key: KEY } });
      expect(history).toHaveLength(2);
    });

    it('still checks the value, and a stale write of an invalid value is refused for being stale', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the stored value', expectedUpdatedAt: null }).expect(200);
      const version = await versionOf(admin, KEY);
      await set(admin, KEY, { value: 45, reason: 'moved on', expectedUpdatedAt: version }).expect(200);

      // The precondition runs before the write; the schema still guards the
      // value on any write that gets past it.
      await set(admin, KEY, { value: 9999, reason: 'stale and out of range', expectedUpdatedAt: version })
        .expect(409);
      await set(admin, KEY, {
        value: 9999,
        reason: 'current but out of range',
        expectedUpdatedAt: await versionOf(admin, KEY),
      }).expect(422);

      await expect(configuration.get(KEY)).resolves.toBe(45);
    });

    it('succeeds on retry once the operator reloads', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the value A read', expectedUpdatedAt: null }).expect(200);
      const readByA = await versionOf(admin, KEY);
      await set(admin, KEY, { value: 45, reason: 'B changes it', expectedUpdatedAt: readByA }).expect(200);

      await set(admin, KEY, { value: 30, reason: 'A, stale', expectedUpdatedAt: readByA }).expect(409);

      // Reload, then submit the same intention against what is actually there.
      const reloaded = await versionOf(admin, KEY);
      await set(admin, KEY, { value: 30, reason: 'A, after reloading', expectedUpdatedAt: reloaded }).expect(200);

      await expect(configuration.get(KEY)).resolves.toBe(30);
    });

    it('guards a reset with the same precondition', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'a value to remove', expectedUpdatedAt: null }).expect(200);
      const readByA = await versionOf(admin, KEY);
      await set(admin, KEY, { value: 45, reason: 'B changes it first', expectedUpdatedAt: readByA }).expect(200);

      await reset(admin, KEY, { reason: 'A resets what they loaded', expectedUpdatedAt: readByA }).expect(409);
      await expect(configuration.get(KEY)).resolves.toBe(45);

      await reset(admin, KEY, { reason: 'A resets after reloading', expectedUpdatedAt: await versionOf(admin, KEY) })
        .expect(200);
      await expect(configuration.get(KEY)).resolves.toBe(REWARDS_HOLD_PERIOD_DAYS.defaultValue);
    });

    it('writes unconditionally when the field is omitted', async () => {
      const admin = await createAdmin();

      /*
       * A seed script has read nothing and has nothing to assert. Omitting the
       * field is that, and it is deliberately distinct from sending `null`,
       * which asserts that nothing is stored.
       */
      await set(admin, KEY, { value: 21, reason: 'a caller with no precondition' }).expect(200);
      await set(admin, KEY, { value: 30, reason: 'and again, still unconditional' }).expect(200);

      await expect(configuration.get(KEY)).resolves.toBe(30);
    });

    it('refuses a precondition that is not a timestamp', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, {
        value: 21,
        reason: 'a malformed precondition',
        expectedUpdatedAt: 'yesterday',
      }).expect(422);
    });

    it('leaves the audit trail intact for the write that won', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the write that landed', expectedUpdatedAt: null })
        .expect(200);
      await set(admin, KEY, { value: 30, reason: 'a stale write that did not', expectedUpdatedAt: null })
        .expect(409);

      const entries = await prisma.adminAuditLog.findMany({
        where: { action: ADMIN_ACTIONS.CONFIGURATION_CHANGED },
      });

      // One entry, for one change. A refused write is not a change, and an
      // audit trail that recorded it would describe something that never
      // happened.
      expect(entries).toHaveLength(1);
      expect(entries[0]?.reason).toBe('the write that landed');
    });
  });


  /**
   * Editing one provider's override — TODO T87.
   *
   * The scope chain and its guards have been tested since Feature 4; what these
   * add is the combination the screen actually performs — write, resolve, reset
   * and the staleness precondition, all at PROVIDER scope — because the
   * precondition is keyed by `(key, scope, scope_id)` and a version that
   * ignored the scope would compare two different rows.
   */
  describe('provider-scoped editing', () => {
    const KEY = REWARDS_HOLD_PERIOD_DAYS.key;

    async function versionOf(caller: Caller, key: string, scopeId: string): Promise<string | null> {
      const path = scopeId
        ? `/admin/configuration/${key}?scopeId=${scopeId}`
        : `/admin/configuration/${key}`;
      const response = await get(caller, path).expect(200);
      const row = (response.body.overrides as { scopeId: string; updatedAt: string }[]).find(
        (override) => override.scopeId === scopeId,
      );

      return row?.updatedAt ?? null;
    }

    it('stores a value for one provider without touching the global one', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'the platform-wide value', expectedUpdatedAt: null })
        .expect(200);
      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'this network settles faster',
        expectedUpdatedAt: null,
      }).expect(200);

      await expect(configuration.get(KEY)).resolves.toBe(21);
      await expect(configuration.get(KEY, providerId)).resolves.toBe(3);
    });

    it('reports what that provider resolves to, and where it came from', async () => {
      const admin = await createAdmin();

      const beforeAny = await get(admin, `/admin/configuration/${KEY}?scopeId=${providerId}`)
        .expect(200);
      expect(beforeAny.body.resolvedForScope).toMatchObject({
        value: REWARDS_HOLD_PERIOD_DAYS.defaultValue,
        source: CONFIG_SOURCES.DEFAULT,
      });

      await set(admin, KEY, { value: 21, reason: 'a global value', expectedUpdatedAt: null }).expect(200);
      const withGlobal = await get(admin, `/admin/configuration/${KEY}?scopeId=${providerId}`).expect(200);
      expect(withGlobal.body.resolvedForScope).toMatchObject({
        value: 21,
        source: CONFIG_SOURCES.GLOBAL,
      });

      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'an override',
        expectedUpdatedAt: null,
      }).expect(200);
      const withOverride = await get(admin, `/admin/configuration/${KEY}?scopeId=${providerId}`).expect(200);
      expect(withOverride.body.resolvedForScope).toMatchObject({
        value: 3,
        source: CONFIG_SOURCES.PROVIDER,
      });
    });

    it('validates a provider value against the same schema', async () => {
      const admin = await createAdmin();

      // One schema per key, whatever the scope. A provider is not a reason for
      // a hold period of 9999 days to become acceptable.
      await set(admin, KEY, {
        value: 9999,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'out of the key’s own range',
        expectedUpdatedAt: null,
      }).expect(422);

      await expect(configuration.get(KEY, providerId)).resolves.toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });

    it('removes one provider’s override and leaves the global value standing', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'global', expectedUpdatedAt: null }).expect(200);
      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'override',
        expectedUpdatedAt: null,
      }).expect(200);

      await reset(admin, KEY, {
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'back to the platform value',
        expectedUpdatedAt: await versionOf(admin, KEY, providerId),
      }).expect(200);

      await expect(configuration.get(KEY, providerId)).resolves.toBe(21);
      await expect(configuration.get(KEY)).resolves.toBe(21);
    });

    it('keeps the two scopes’ preconditions apart', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, { value: 21, reason: 'global', expectedUpdatedAt: null }).expect(200);
      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'override',
        expectedUpdatedAt: null,
      }).expect(200);

      const globalVersion = await versionOf(admin, KEY, '');
      const providerVersion = await versionOf(admin, KEY, providerId);
      expect(globalVersion).not.toBe(providerVersion);

      /*
       * The rows move independently, so a version from one is stale against the
       * other. A precondition that ignored the scope would pass here, and the
       * write would land on a row the operator never read.
       */
      await set(admin, KEY, {
        value: 5,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'asserting the global version by mistake',
        expectedUpdatedAt: globalVersion,
      }).expect(409);

      await set(admin, KEY, {
        value: 5,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'asserting this provider’s own version',
        expectedUpdatedAt: providerVersion,
      }).expect(200);

      // And the global row is untouched by all of it.
      await expect(configuration.get(KEY)).resolves.toBe(21);
      await expect(configuration.get(KEY, providerId)).resolves.toBe(5);
    });

    it('refuses a stale provider write, and records nothing for it', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'the value A read',
        expectedUpdatedAt: null,
      }).expect(200);
      const readByA = await versionOf(admin, KEY, providerId);

      await set(admin, KEY, {
        value: 7,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'B changes it meanwhile',
        expectedUpdatedAt: readByA,
      }).expect(200);

      const stale = await set(admin, KEY, {
        value: 5,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'A submits what they loaded',
        expectedUpdatedAt: readByA,
      }).expect(409);

      expect(stale.body.error.code).toBe(ERROR_CODES.CONFIG_STALE_WRITE);
      await expect(configuration.get(KEY, providerId)).resolves.toBe(7);
    });

    it('counts provider overrides, not every stored row', async () => {
      const admin = await createAdmin();

      /*
       * `overrideCount` is documented as "how many provider-scoped overrides
       * exist", and the settings screen turns it into "N providers have their
       * own value". It was the total of every row for the key, so a global
       * value plus one provider override reported two providers — visible the
       * moment the screen started rendering that sentence.
       *
       * The `overriddenOnly` filter still asks a different question — has
       * anybody stored anything — and still counts both.
       */
      await set(admin, KEY, { value: 21, reason: 'a global value', expectedUpdatedAt: null }).expect(200);

      const globalOnly = await get(admin, `/admin/configuration?search=${KEY}`).expect(200);
      expect(globalOnly.body.items[0]).toMatchObject({ key: KEY, overrideCount: 0 });

      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'one provider override',
        expectedUpdatedAt: null,
      }).expect(200);

      const withOverride = await get(admin, `/admin/configuration?search=${KEY}`).expect(200);
      expect(withOverride.body.items[0]).toMatchObject({ key: KEY, overrideCount: 1 });

      const detail = await get(admin, `/admin/configuration/${KEY}`).expect(200);
      expect(detail.body.overrideCount).toBe(1);
      // Both rows are still listed; only the count changed meaning.
      expect(detail.body.overrides).toHaveLength(2);
    });

    it('still lists a key whose only stored value is a provider override', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'nothing global, one override',
        expectedUpdatedAt: null,
      }).expect(200);

      // "What has anybody changed" must include it: somebody changed it.
      const filtered = await get(admin, '/admin/configuration?overriddenOnly=true').expect(200);
      expect((filtered.body.items as { key: string }[]).map((i) => i.key)).toContain(KEY);
    });

    it('audits a provider change against the provider, not the key alone', async () => {
      const admin = await createAdmin();

      await set(admin, KEY, {
        value: 3,
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'auditable per provider',
        expectedUpdatedAt: null,
      }).expect(200);

      const entries = await prisma.adminAuditLog.findMany({
        where: { action: ADMIN_ACTIONS.CONFIGURATION_CHANGED },
      });

      // "Who changed the hold period *for this provider*" is the question, and
      // a target of the key alone could not answer it.
      expect(entries).toHaveLength(1);
      expect(entries[0]?.targetId).toContain(providerId);
    });

    it('refuses a provider override on a key that does not declare the scope', async () => {
      const admin = await createAdmin();

      // Global-only by declaration. A key meaningless per provider must not be
      // settable per provider, or the chain returns a value nobody intended.
      await set(admin, PAYOUTS_ENABLED_METHODS.key, {
        value: ['paypal'],
        scope: CONFIG_SCOPES.PROVIDER,
        scopeId: providerId,
        reason: 'not a per-provider key',
        expectedUpdatedAt: null,
      }).expect(422);
    });

    it('refuses a provider override from someone who is not an admin', async () => {
      const user = await createUser();

      await request(server())
        .put(`/admin/configuration/${KEY}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          value: 3,
          scope: CONFIG_SCOPES.PROVIDER,
          scopeId: providerId,
          reason: 'not an admin at all',
        })
        .expect(403);

      await expect(configuration.get(KEY, providerId)).resolves.toBe(
        REWARDS_HOLD_PERIOD_DAYS.defaultValue,
      );
    });
  });

  // --- Helpers -------------------------------------------------------------

  const server = () => app.getHttpServer();

  interface Caller {
    id: string;
    token: string;
  }

  async function createUser(): Promise<Caller> {
    const email = nextEmail();
    const response = await request(server())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    return { id: response.body.user.id, token: response.body.accessToken };
  }

  async function createAdmin(): Promise<Caller> {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

    const relogin = await request(server())
      .post('/auth/login')
      .send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, password })
      .expect(200);

    return { id: user.id, token: relogin.body.accessToken };
  }

  function get(caller: Caller, path: string) {
    return request(server()).get(path).set('Authorization', `Bearer ${caller.token}`);
  }

  function set(
    caller: Caller,
    key: string,
    body: {
      value: unknown;
      scope?: string;
      scopeId?: string;
      reason: string;
      expectedUpdatedAt?: string | null;
    },
  ) {
    return request(server())
      .put(`/admin/configuration/${key}`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);
  }

  function reset(
    caller: Caller,
    key: string,
    body: { scope?: string; scopeId?: string; reason: string; expectedUpdatedAt?: string | null },
  ) {
    return request(server())
      .post(`/admin/configuration/${key}/reset`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send(body);
  }
});
