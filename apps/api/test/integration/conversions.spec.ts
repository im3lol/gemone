import { createHmac } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  CONVERSION_STATUSES,
  CONVERSION_TYPES,
  POSTBACK_STATES,
  QUARANTINE_REASONS,
  SYNC_MODES,
} from '@gemone/contracts';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { QUEUES } from '../../src/core/queue/queue.constants';
import { ClicksService } from '../../src/modules/clicks/clicks.service';
import { ConversionsService } from '../../src/modules/conversions/conversions.service';
import {
  PostbackIntakeService,
  type PostbackEnvelope,
} from '../../src/modules/conversions/postback-intake.service';
import { OFFERS_REWARD_SHARE_PERCENT } from '../../src/modules/offers/offers.config';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import { UsersService } from '../../src/modules/users/users.service';
import { OFFERS_POINTS_PER_MINOR_UNIT } from '../../src/modules/offers/offers.config';

/**
 * Conversion processing against a real Postgres and Redis — §10.3, §18.3.
 *
 * The pipeline is exercised end to end from a real postback: intake archives
 * it, processing re-parses the archive, resolves the click, and writes the
 * conversion. Nothing here constructs a `NormalizedConversion` by hand — that
 * would test the parts in isolation and skip the seam where they meet, which
 * is where the previous two features both found their real bugs.
 */
describe('conversion processing (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let intake: PostbackIntakeService;
  let conversions: ConversionsService;
  let clicks: ClicksService;
  let providers: ProvidersService;
  let users: UsersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  let queue: Queue;

  let providerId: string;
  let offerId: string;

  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';

  let counter = 0;
  const nextTransactionId = () => `TX-CONV-${Date.now()}-${++counter}`;
  const nextEmail = () => `conv-${++counter}.${Date.now()}@example.com`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    intake = moduleRef.get(PostbackIntakeService);
    conversions = moduleRef.get(ConversionsService);
    clicks = moduleRef.get(ClicksService);
    providers = moduleRef.get(ProvidersService);
    users = moduleRef.get(UsersService);
    catalog = moduleRef.get(CatalogSyncService);
    configuration = moduleRef.get(ConfigurationService);
    queue = moduleRef.get<Queue>(getQueueToken(QUEUES.POSTBACKS));
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
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
    await queue.obliterate({ force: true }).catch(() => undefined);

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);

    offerId = (await prisma.offer.findFirstOrThrow({ where: { externalId: 'MK-100241' } })).id;
  });

  // --- Building the world a conversion needs -------------------------------

  async function createUser(status: 'ACTIVE' | 'BANNED' | 'SUSPENDED' = 'ACTIVE') {
    const user = await users.create({
      email: nextEmail(),
      passwordHash: 'not-a-real-hash',
    });

    if (status !== 'ACTIVE') {
      await prisma.user.update({ where: { id: user.id }, data: { status } });
    }

    return user;
  }

  /** A real click, so the `sub_id` is genuinely signed by the running key. */
  async function createClick(userId: string) {
    return clicks.create({ userId, offerId, ipAddress: '198.51.100.7' });
  }

  function sign(query: Record<string, string>): Record<string, string> {
    const canonical = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');

    return { ...query, sig: createHmac('sha256', SECRET).update(canonical).digest('hex') };
  }

  function envelope(query: Record<string, string>): PostbackEnvelope {
    return {
      providerSlug: 'mock',
      method: 'GET',
      query,
      body: undefined,
      headers: { 'user-agent': 'ProviderBot/1.0' },
      sourceIp: '203.0.113.10',
    };
  }

  /** Delivers a postback exactly as a provider would, and returns its row. */
  async function deliver(overrides: Record<string, string> = {}) {
    const query = sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: '2026-08-02T12:00:00Z',
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: 'placeholder',
      transaction_id: nextTransactionId(),
      ...overrides,
    });

    await intake.receive(envelope(query));

    return prisma.providerPostback.findFirstOrThrow({
      where: { externalTransactionId: query.transaction_id },
    });
  }

  // --- The happy path ------------------------------------------------------

  describe('attributing a conversion', () => {
    it('records it against the click, the user and the offer', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      const result = await conversions.process(postback.id);

      expect(result.outcome).toBe('converted');

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.clickId).toBe(click.id);
      expect(conversion.userId).toBe(user.id);
      expect(conversion.offerId).toBe(offerId);
      expect(conversion.providerId).toBe(providerId);
      expect(conversion.postbackId).toBe(postback.id);
      expect(conversion.status).toBe(CONVERSION_STATUSES.CREDITED);
      expect(conversion.type).toBe(CONVERSION_TYPES.CONVERSION);
    });

    it('names the credit with the offer title the user was shown at click time', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);

      const credit = await prisma.rewardTransaction.findFirstOrThrow({
        where: { userId: user.id, type: 'CONVERSION_CREDIT' },
      });

      /*
       * TODO T77's fix. The statement has to be able to say *which* offer
       * paid, and `rewards` cannot look it up: it depends on no other domain
       * module, and `conversions → rewards` is already an arrow (P2). So the
       * caller hands the name over with the points.
       *
       * The value is the click's snapshot, not the offer row. Offers are
       * overwritten by every catalog sync, so reading `offers.title` later
       * would print today's title on a line about money that moved months ago.
       */
      expect(credit.sourceLabel).toBe(click.offerTitle);
      expect(credit.sourceLabel).not.toBeNull();
    });

    it('marks the postback processed in the same breath', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);

      const stored = await prisma.providerPostback.findUniqueOrThrow({
        where: { id: postback.id },
      });

      // DATABASE.md §10.1: create conversion → mark processed is one
      // transaction. Partial completion is a missing or duplicated credit.
      expect(stored.state).toBe(POSTBACK_STATES.PROCESSED);
      expect(stored.processingAttempts).toBe(1);
      expect(stored.errorDetail).toBeNull();
    });

    it('prices the payout the provider actually reported, at the configured rate', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      // 2.45 USD = 245 minor units. Default rate: 1 point per minor unit, 70%.
      const postback = await deliver({ sub_id: click.subId, payout: '2.45' });

      await conversions.process(postback.id);

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.payoutAmountMinor).toBe(245);
      expect(conversion.rewardPoints).toBe(171); // floor(245 * 1 * 70 / 100)
    });

    it('stores the rate it used, so the number can be explained later', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);
      const conversion = await prisma.conversion.findFirstOrThrow();

      expect(conversion.pointsPerMinorUnit).toBe(1);
      expect(conversion.rewardSharePercent).toBe(70);

      /*
       * The rule in force at the moment of the event is part of the event.
       * An admin changing the rate afterwards must not restate what an
       * existing conversion was worth — "why did I get fewer points than my
       * friend for the same offer?" has to stay answerable (P3).
       */
      await configuration.set(OFFERS_REWARD_SHARE_PERCENT.key, 40, {
        actor: { type: 'system' },
      });

      const unchanged = await prisma.conversion.findFirstOrThrow();
      expect(unchanged.rewardSharePercent).toBe(70);
      expect(unchanged.rewardPoints).toBe(171);
    });

    it('keeps the provider evidence a fraud investigation will need', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({
        sub_id: click.subId,
        campaign_id: 'MK-100241',
        event_time: '2026-08-02T12:00:00Z',
      });

      await conversions.process(postback.id);
      const conversion = await prisma.conversion.findFirstOrThrow();

      expect(conversion.externalTransactionId).toBe(postback.externalTransactionId);
      expect(conversion.externalOfferId).toBe('MK-100241');
      expect(conversion.providerStatus).toBe('confirmed');
      expect(conversion.occurredAt?.toISOString()).toBe('2026-08-02T12:00:00.000Z');

      // And the whole chain back to the raw bytes, plus the click's IP,
      // user agent and fingerprint, is reachable from these two ids.
      expect(conversion.postbackId).toBe(postback.id);
      expect(conversion.clickId).toBe(click.id);
    });

    it('separates when the provider says it happened from when we heard', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId, event_time: '' });

      await conversions.process(postback.id);
      const conversion = await prisma.conversion.findFirstOrThrow();

      // Null rather than defaulted to now: a payload that omitted the time
      // must not be recorded as having claimed one.
      expect(conversion.occurredAt).toBeNull();
      expect(conversion.createdAt).toBeInstanceOf(Date);
    });

    it('lets one click produce several conversions', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      const first = await deliver({ sub_id: click.subId });
      const second = await deliver({ sub_id: click.subId, payout: '1.00' });

      await conversions.process(first.id);
      await conversions.process(second.id);

      /*
       * Multi-step offers pay out in stages (DATABASE.md §4). A `converted`
       * boolean on the click would have been wrong the moment the second
       * event arrived.
       */
      expect(await prisma.conversion.count({ where: { clickId: click.id } })).toBe(2);
    });
  });

  // --- Idempotency ---------------------------------------------------------

  describe('idempotency', () => {
    it('skips a postback that was already processed', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);
      const second = await conversions.process(postback.id);

      expect(second.outcome).toBe('skipped');
      expect(await prisma.conversion.count()).toBe(1);
    });

    it('produces exactly one conversion under concurrent processing', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      /*
       * **The test the unique index exists for.**
       *
       * The `RECEIVED` check is not a lock, so every caller sees the row
       * unprocessed and every caller proceeds. Only the constraint on
       * `postback_id` decides — and the losers must report the winner's row
       * rather than failing, because a failed job whose work is done would
       * retry and lose the same race again.
       */
      const results = await Promise.all(
        Array.from({ length: 6 }, () => conversions.process(postback.id)),
      );

      expect(await prisma.conversion.count()).toBe(1);

      const conversionIds = new Set(
        results.map((r) => r.conversionId).filter((id): id is string => id !== null),
      );
      expect(conversionIds.size).toBe(1);
      expect(results.every((r) => r.outcome !== 'quarantined')).toBe(true);
    });

    it('does nothing for a job whose row is gone', async () => {
      const result = await conversions.process('0192f0a0-0000-7000-8000-0000000000aa');

      expect(result.outcome).toBe('skipped');
      expect(result.conversionId).toBeNull();
    });

    it('does not reprocess a quarantined postback', async () => {
      const postback = await deliver({ sub_id: 'never-issued.by-us' });

      await conversions.process(postback.id);
      const second = await conversions.process(postback.id);

      // Retrying a quarantine would overwrite the attempt count and hide how
      // long a row has been waiting for somebody.
      expect(second.outcome).toBe('skipped');
    });
  });

  // --- Attribution failures, none of them silent ---------------------------

  describe('quarantine', () => {
    async function expectQuarantine(
      postbackId: string,
      reason: (typeof QUARANTINE_REASONS)[keyof typeof QUARANTINE_REASONS],
    ) {
      const result = await conversions.process(postbackId);

      expect(result.outcome).toBe('quarantined');
      expect(result.reason).toBe(reason);
      expect(await prisma.conversion.count()).toBe(0);

      const stored = await prisma.providerPostback.findUniqueOrThrow({
        where: { id: postbackId },
      });
      expect(stored.state).toBe(POSTBACK_STATES.QUARANTINED);
      expect(stored.errorDetail).toBe(reason);
    }

    it('quarantines a sub_id we never signed', async () => {
      // Forged, or from before a signing-key rotation. Either way it was never
      // one of ours, and the signature says so without a database lookup.
      const postback = await deliver({ sub_id: 'AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB' });

      await expectQuarantine(postback.id, QUARANTINE_REASONS.SUB_ID_INVALID);
    });

    it('quarantines a signed sub_id no click carries', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      // Signed by us, and the click is gone — the shape a database restore to
      // an earlier point leaves behind.
      await prisma.click.delete({ where: { id: click.id } });

      await expectQuarantine(postback.id, QUARANTINE_REASONS.CLICK_NOT_FOUND);
    });

    it('quarantines a conversion arriving after the attribution window closed', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await prisma.click.update({
        where: { id: click.id },
        data: { attributionExpiresAt: new Date(Date.now() - 1000) },
      });

      /*
       * Quarantined rather than dropped, and rather than credited. The user
       * may well have completed the offer; whether we honour it that late is
       * a commercial decision, and a human makes it with the evidence in
       * front of them (PROJECT.md §4.4).
       */
      await expectQuarantine(postback.id, QUARANTINE_REASONS.ATTRIBUTION_EXPIRED);
    });

    it('quarantines a payout in a currency the rate is not calibrated for', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId, currency: 'EUR', payout: '2.45' });

      // Applying a USD-calibrated rate to euros is silently wrong by whatever
      // the exchange rate happens to be, and invisible afterwards.
      await expectQuarantine(postback.id, QUARANTINE_REASONS.CURRENCY_MISMATCH);
    });

    it('quarantines when this build cannot read the payload at all', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      // The row survives its adapter being removed from the build — which is
      // exactly when the archive matters most.
      await prisma.provider.update({
        where: { id: providerId },
        data: { slug: 'no-such-adapter' },
      });
      await providers.reload();

      await expectQuarantine(postback.id, QUARANTINE_REASONS.PROVIDER_UNAVAILABLE);

      await prisma.provider.update({ where: { id: providerId }, data: { slug: 'mock' } });
      await providers.reload();
    });

    it('quarantines an archived payload that no longer parses', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      // It parsed at intake and does not now: the adapter changed underneath
      // it. Quarantine keeps the row replayable once that is fixed.
      await prisma.providerPostback.update({
        where: { id: postback.id },
        data: { payload: { method: 'GET', query: { nothing: 'useful' }, body: null } },
      });

      await expectQuarantine(postback.id, QUARANTINE_REASONS.PAYLOAD_UNREADABLE);
    });

    it('counts every attempt, so a stuck row is visible', async () => {
      const postback = await deliver({ sub_id: 'AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB' });

      await conversions.process(postback.id);

      const stored = await prisma.providerPostback.findUniqueOrThrow({
        where: { id: postback.id },
      });
      expect(stored.processingAttempts).toBe(1);
    });
  });

  // --- The account check ---------------------------------------------------

  describe('the account behind the click', () => {
    it.each([['BANNED'] as const, ['SUSPENDED'] as const])(
      'holds rather than refuses a conversion for a %s account',
      async (status) => {
        const user = await createUser(status);
        const click = await createClick(user.id);
        const postback = await deliver({ sub_id: click.subId });

        const result = await conversions.process(postback.id);

        /*
         * §10.3 step 3. The conversion is recorded — the user did the work and
         * the evidence must exist — and nothing may be credited for it until
         * somebody looks. Refusing outright would leave no recoverable record
         * of an event that did happen.
         */
        expect(result.outcome).toBe('converted');

        const conversion = await prisma.conversion.findFirstOrThrow();
        expect(conversion.status).toBe(CONVERSION_STATUSES.HELD);
        expect(conversion.reviewReason).toContain('not active');
      },
    );

    it('records a provider-pending event as pending, creditable by nothing', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId, status: '0' });

      await conversions.process(postback.id);

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.PENDING);
      expect(conversion.providerStatus).toBe('pending');
    });

    it('records a provider-rejected event without holding it for review', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId, status: '2' });

      await conversions.process(postback.id);

      const conversion = await prisma.conversion.findFirstOrThrow();
      expect(conversion.status).toBe(CONVERSION_STATUSES.REJECTED);
      expect(conversion.providerStatus).toBe('rejected');
    });
  });

  // --- Chargebacks ---------------------------------------------------------

  describe('reversals', () => {
    it('records a reversal as its own row and marks the original reversed', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      const originalPostback = await deliver({ sub_id: click.subId });
      await conversions.process(originalPostback.id);
      const original = await prisma.conversion.findFirstOrThrow();

      const reversalPostback = await deliver({ sub_id: click.subId, reversed: '1' });
      const result = await conversions.process(reversalPostback.id);

      expect(result.outcome).toBe('converted');

      const reversal = await prisma.conversion.findUniqueOrThrow({
        where: { postbackId: reversalPostback.id },
      });
      expect(reversal.type).toBe(CONVERSION_TYPES.REVERSAL);
      expect(reversal.reversalOfId).toBe(original.id);

      /*
       * Reversals are rows, not edits (DATABASE.md §3.4). Editing the original
       * away would destroy the record that the user *did* complete the offer,
       * which is exactly what matters when disputing the reversal with the
       * provider.
       */
      const after = await prisma.conversion.findUniqueOrThrow({ where: { id: original.id } });
      expect(after.status).toBe(CONVERSION_STATUSES.REVERSED);
      expect(after.rewardPoints).toBe(original.rewardPoints);
    });

    it('names the chargeback with the same offer as the credit it takes back', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      await conversions.process((await deliver({ sub_id: click.subId })).id);
      await conversions.process((await deliver({ sub_id: click.subId, reversed: '1' })).id);

      const chargeback = await prisma.rewardTransaction.findFirstOrThrow({
        where: { userId: user.id, type: 'CHARGEBACK_DEBIT' },
      });

      // One offer, one name, however many rows its story takes. The reversal
      // supplies no label of its own, so `reverse` copies the credit's.
      expect(chargeback.sourceLabel).toBe(click.offerTitle);
    });

    it('quarantines a reversal for a conversion we never saw', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId, reversed: '1' });

      // §10.3: "A reversal for a conversion we never saw is quarantined, not
      // ignored." Ignoring it leaves credited points nobody can explain.
      const result = await conversions.process(postback.id);

      expect(result.reason).toBe(QUARANTINE_REASONS.REVERSAL_ORIGINAL_NOT_FOUND);
      expect(await prisma.conversion.count()).toBe(0);
    });

    it('quarantines rather than guesses when two conversions could match', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      for (const _ of [1, 2]) {
        const p = await deliver({ sub_id: click.subId });
        await conversions.process(p.id);
      }
      expect(await prisma.conversion.count()).toBe(2);

      const reversalPostback = await deliver({ sub_id: click.subId, reversed: '1' });
      const result = await conversions.process(reversalPostback.id);

      /*
       * Picking "the most recent" would reverse whichever happened to sort
       * first and be wrong silently, in money. A human resolving one reversal
       * is cheaper than a rule nobody can see being wrong (TODO T24).
       */
      expect(result.reason).toBe(QUARANTINE_REASONS.REVERSAL_AMBIGUOUS);

      const statuses = await prisma.conversion.findMany({ select: { status: true } });
      expect(statuses.every((c) => c.status !== CONVERSION_STATUSES.REVERSED)).toBe(true);
    });

    it('disambiguates by the amount being taken back', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      const cheap = await deliver({ sub_id: click.subId, payout: '1.00' });
      await conversions.process(cheap.id);
      const dear = await deliver({ sub_id: click.subId, payout: '2.45' });
      await conversions.process(dear.id);

      const reversalPostback = await deliver({
        sub_id: click.subId,
        reversed: '1',
        payout: '1.00',
      });
      await conversions.process(reversalPostback.id);

      const reversedRows = await prisma.conversion.findMany({
        where: { status: CONVERSION_STATUSES.REVERSED },
      });

      expect(reversedRows).toHaveLength(1);
      expect(reversedRows[0]!.payoutAmountMinor).toBe(100);
    });

    it('does not reverse the same conversion twice', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      const originalPostback = await deliver({ sub_id: click.subId });
      await conversions.process(originalPostback.id);

      const firstReversal = await deliver({ sub_id: click.subId, reversed: '1' });
      await conversions.process(firstReversal.id);

      const secondReversal = await deliver({ sub_id: click.subId, reversed: '1' });
      const result = await conversions.process(secondReversal.id);

      // The original is already REVERSED, so it is no longer a candidate.
      expect(result.reason).toBe(QUARANTINE_REASONS.REVERSAL_ORIGINAL_NOT_FOUND);
    });
  });

  // --- The worker's view of the world --------------------------------------

  describe('a registry that went stale', () => {
    it('reloads on a miss rather than quarantining a live provider', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      /*
       * The bug this prevents is the one the catalog path hit in D14: the
       * worker holds an in-memory registry taken at boot, so a provider
       * created or enabled afterwards is invisible to it — forever, and only
       * in the process that matters.
       *
       * Simulated by emptying the registry, which is exactly the state a
       * worker started before the provider existed would be in.
       */
      moduleRef.get(ProvidersService);
      const registry = moduleRef.get(
        (await import('../../src/modules/providers/registry/provider-registry')).ProviderRegistry,
      );
      registry.load([]);
      expect(registry.find('mock')).toBeUndefined();

      const result = await conversions.process(postback.id);

      expect(result.outcome).toBe('converted');
    });
  });

  // --- Configuration is per provider (P3) ----------------------------------

  describe('per-provider economics', () => {
    it('prices with the provider-scoped rate when one is set', async () => {
      await configuration.set(OFFERS_REWARD_SHARE_PERCENT.key, 50, {
        scope: 'PROVIDER',
        scopeId: providerId,
        actor: { type: 'system' },
      });

      // Global stays at 70, so a value read here proves the PROVIDER scope
      // won the resolution chain rather than merely agreeing with it.
      await expect(
        configuration.get<number>(OFFERS_REWARD_SHARE_PERCENT.key),
      ).resolves.toBe(70);

      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);
      const conversion = await prisma.conversion.findFirstOrThrow();

      // Networks differ in payout reliability, so a single rate across all of
      // them is either leaving money on the table or losing it.
      expect(conversion.rewardSharePercent).toBe(50);
      expect(conversion.rewardPoints).toBe(122); // floor(245 * 1 * 50 / 100)
    });
  });

  // --- Reads ---------------------------------------------------------------

  describe('reading conversions', () => {
    it('filters by user, status and type', async () => {
      const user = await createUser();
      const click = await createClick(user.id);

      const ok = await deliver({ sub_id: click.subId });
      await conversions.process(ok.id);
      const pending = await deliver({ sub_id: click.subId, status: '0', payout: '1.00' });
      await conversions.process(pending.id);

      await expect(conversions.findMany({ userId: user.id })).resolves.toMatchObject({
        total: 2,
      });
      await expect(
        conversions.findMany({ status: CONVERSION_STATUSES.PENDING }),
      ).resolves.toMatchObject({ total: 1 });
      await expect(
        conversions.findMany({ type: CONVERSION_TYPES.CONVERSION }),
      ).resolves.toMatchObject({ total: 2 });
    });

    it('finds the conversion one postback produced', async () => {
      const user = await createUser();
      const click = await createClick(user.id);
      const postback = await deliver({ sub_id: click.subId });

      await conversions.process(postback.id);

      const found = await conversions.findByPostbackId(postback.id);
      expect(found?.postbackId).toBe(postback.id);
    });

    it('reports a missing conversion rather than returning nothing', async () => {
      await expect(
        conversions.requireById('0192f0a0-0000-7000-8000-0000000000aa'),
      ).rejects.toMatchObject({ code: 'CONVERSION_NOT_FOUND', httpStatus: 404 });
    });
  });
});
