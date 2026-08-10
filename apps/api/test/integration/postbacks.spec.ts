import { createHmac } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { ERROR_CODES, POSTBACK_STATES, SYNC_MODES } from '@gemone/contracts';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { QUEUES } from '../../src/core/queue/queue.constants';
import {
  PostbackIntakeService,
  type PostbackEnvelope,
} from '../../src/modules/conversions/postback-intake.service';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';

/**
 * The postback intake surface against a real Postgres and a real Redis —
 * ARCHITECTURE.md §10, §18.3.
 *
 * The single most important claim in this file is the concurrent-duplicate
 * test. Idempotency enforced anywhere above the database is idempotency that
 * fails under exactly the retry storm it was built for (§10.1), and a mocked
 * client cannot lose that race — so it cannot prove we do not.
 */
describe('postback intake (integration)', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;
  let intake: PostbackIntakeService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;
  let queue: Queue;

  let providerId: string;

  /**
   * The fixture secret, committed on purpose (see the adapter's fixtures): it
   * authenticates nothing, and a signature that cannot be reproduced can only
   * be tested by disabling the check it exists to test.
   */
  const SECRET = process.env.PROVIDER_MOCK_SECRET ?? 'mock-fixture-secret';

  let transactionCounter = 0;
  const nextTransactionId = () => `TX-${Date.now()}-${++transactionCounter}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    intake = moduleRef.get(PostbackIntakeService);
    providers = moduleRef.get(ProvidersService);
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

    await queue.obliterate({ force: true }).catch(() => undefined);

    const provider = await providers.create({ slug: 'mock', displayName: 'Mock Offerwall' });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);
  });

  // --- Building a postback the way the provider would ----------------------

  /**
   * Signs exactly as the adapter verifies: HMAC-SHA256 over the query
   * parameters sorted by key, excluding the signature itself.
   *
   * Reimplemented here rather than imported. A test that signs with the same
   * function it verifies against passes even when both are wrong — this
   * spells the provider's dialect out, so a change to the adapter's canonical
   * form is a test failure rather than a silent agreement.
   */
  function sign(query: Record<string, string>): Record<string, string> {
    const canonical = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');

    return {
      ...query,
      sig: createHmac('sha256', SECRET).update(canonical).digest('hex'),
    };
  }

  function conversionQuery(overrides: Record<string, string> = {}): Record<string, string> {
    return sign({
      campaign_id: 'MK-100241',
      currency: 'USD',
      event_time: '2026-08-02T10:00:00Z',
      payout: '2.45',
      reversed: '0',
      status: '1',
      sub_id: 'not-resolved-at-intake',
      transaction_id: nextTransactionId(),
      ...overrides,
    });
  }

  function envelope(
    query: Record<string, string>,
    overrides: Partial<PostbackEnvelope> = {},
  ): PostbackEnvelope {
    return {
      providerSlug: 'mock',
      method: 'GET',
      query,
      body: undefined,
      headers: { 'user-agent': 'ProviderBot/1.0' },
      sourceIp: '203.0.113.10',
      ...overrides,
    };
  }

  // --- The happy path ------------------------------------------------------

  describe('accepting an authentic postback', () => {
    it('archives it verbatim and acknowledges', async () => {
      const query = conversionQuery();

      await expect(intake.receive(envelope(query))).resolves.toEqual({ status: 'accepted' });

      const stored = await prisma.providerPostback.findFirstOrThrow();

      expect(stored.providerId).toBe(providerId);
      expect(stored.externalTransactionId).toBe(query.transaction_id);
      expect(stored.state).toBe(POSTBACK_STATES.RECEIVED);
      expect(stored.sourceIp).toBe('203.0.113.10');
      expect(stored.duplicateCount).toBe(0);

      // "Verbatim" is the whole value of the archive: it is the dispute
      // evidence and the replay source (§10.1).
      expect(stored.payload).toMatchObject({ method: 'GET', query });
    });

    it('acknowledges without any identifier of ours', async () => {
      /*
       * Our ids are UUIDv7 — a timestamp and a monotonic sort order. Handing
       * one to a third party publishes our conversion volume, which is the
       * same reasoning that made `sub_id` random (§19.2).
       */
      const result = await intake.receive(envelope(conversionQuery()));

      expect(Object.keys(result)).toEqual(['status']);
    });

    it('enqueues processing keyed on the archived row', async () => {
      await intake.receive(envelope(conversionQuery()));

      const stored = await prisma.providerPostback.findFirstOrThrow();
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);

      // The row id is the job's natural key (§13.2), so a re-dispatch of the
      // same postback is a no-op rather than a second credit attempt.
      expect(jobs.map((job) => job.data.postbackId)).toContain(stored.id);
    });

    it('does not enqueue anything for a duplicate', async () => {
      const query = conversionQuery();

      await intake.receive(envelope(query));
      await intake.receive(envelope(query));
      await intake.receive(envelope(query));

      // Three deliveries, one event, one job. A second job would be a second
      // credit attempt for work the user did once.
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      expect(jobs).toHaveLength(1);
    });

    it('still acknowledges when the queue is unreachable', async () => {
      const failing = vi
        .spyOn(queue, 'add')
        .mockRejectedValue(new Error('Redis connection lost'));

      try {
        /*
         * The row is already durable, and 500 would make the provider retry —
         * which we would then correctly recognise as a duplicate and still not
         * enqueue. The retry buys nothing and costs a duplicate.
         *
         * `provider_postbacks` is the replay source (§10.1): a RECEIVED row
         * with no job is exactly what a replay finds and re-dispatches.
         */
        await expect(intake.receive(envelope(conversionQuery()))).resolves.toEqual({
          status: 'accepted',
        });

        const stored = await prisma.providerPostback.findFirstOrThrow();
        expect(stored.state).toBe(POSTBACK_STATES.RECEIVED);
      } finally {
        failing.mockRestore();
      }
    });

    it('keeps a reversal as its own row, not an edit of the original', async () => {
      const original = conversionQuery();
      await intake.receive(envelope(original));

      const reversal = conversionQuery({
        reversed: '1',
        transaction_id: `${original.transaction_id}-R`,
      });
      await intake.receive(envelope(reversal));

      /*
       * A chargeback is a different event with a different provider
       * transaction id. Collapsing the two would destroy the record that the
       * user did complete the offer — which is what a dispute with the
       * provider turns on (DATABASE.md §3.4).
       */
      expect(await prisma.providerPostback.count()).toBe(2);
    });
  });

  // --- The constraint ------------------------------------------------------

  describe('idempotency', () => {
    it('acknowledges a repeat without archiving it twice', async () => {
      const query = conversionQuery();

      await expect(intake.receive(envelope(query))).resolves.toEqual({ status: 'accepted' });
      await expect(intake.receive(envelope(query))).resolves.toEqual({ status: 'duplicate' });

      expect(await prisma.providerPostback.count()).toBe(1);
    });

    it('counts repeats on the row they duplicate', async () => {
      const query = conversionQuery();

      await intake.receive(envelope(query));
      await intake.receive(envelope(query));
      await intake.receive(envelope(query));

      const stored = await prisma.providerPostback.findFirstOrThrow();

      // §10.1's "mark duplicate". A count climbing while nothing else changes
      // says our acknowledgement is not reaching the provider.
      expect(stored.duplicateCount).toBe(2);
      expect(stored.lastDuplicateAt).not.toBeNull();
    });

    it('survives a concurrent retry storm with exactly one row', async () => {
      const query = conversionQuery();

      /*
       * **The test this table exists for.**
       *
       * A check-then-insert loses precisely this race: every caller looks,
       * every caller finds nothing, every caller inserts. The unique index
       * makes all but one fail no matter how the requests interleave — which
       * is why §10.1 puts the guarantee in the database and DATABASE.md §9.1
       * calls it the most important index there is.
       */
      const results = await Promise.all(
        Array.from({ length: 8 }, () => intake.receive(envelope(query))),
      );

      expect(await prisma.providerPostback.count()).toBe(1);
      expect(results.filter((r) => r.status === 'accepted')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(7);
    });

    it('is scoped to the provider, not to the transaction id alone', async () => {
      /*
       * Two networks can legitimately issue the same transaction id, so a
       * constraint on the id alone would reject one provider's conversion
       * because another had already used the number. Asserted against the
       * live index rather than by creating a second provider, because this
       * build ships one adapter and a row may only name a slug it implements
       * (§7.3).
       */
      const unique = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'provider_postbacks'
           AND indexdef LIKE 'CREATE UNIQUE INDEX%'
           AND indexdef LIKE '%external_transaction_id%'`;

      expect(unique).toHaveLength(1);
      expect(unique[0]!.indexdef).toContain('provider_id');
    });
  });

  // --- Defence in depth ----------------------------------------------------

  describe('the provider gate', () => {
    it('refuses an unknown slug and archives nothing', async () => {
      await expect(
        intake.receive(envelope(conversionQuery(), { providerSlug: 'nobody' })),
      ).rejects.toMatchObject({ code: ERROR_CODES.PROVIDER_NOT_FOUND, httpStatus: 404 });

      expect(await prisma.providerPostback.count()).toBe(0);
    });

    it('refuses a disabled provider', async () => {
      await providers.setEnabled(providerId, false);
      await providers.reload();

      /*
       * "A disabled provider is inert" (§7.3) has to include its public
       * endpoint, or disabling would not stop the thing an operator disabled
       * it to stop — which at 2 a.m. is a network sending malformed
       * postbacks.
       */
      await expect(intake.receive(envelope(conversionQuery()))).rejects.toMatchObject({
        code: ERROR_CODES.PROVIDER_DISABLED,
      });

      expect(await prisma.providerPostback.count()).toBe(0);
    });
  });

  describe('the source allowlist', () => {
    beforeEach(async () => {
      await providers.update(providerId, { postbackIpRanges: ['203.0.113.0/24'] });
    });

    it('accepts an address inside the range', async () => {
      await expect(
        intake.receive(envelope(conversionQuery(), { sourceIp: '203.0.113.77' })),
      ).resolves.toEqual({ status: 'accepted' });
    });

    it('accepts the IPv4-mapped form a dual-stack socket reports', async () => {
      /*
       * Node reports an IPv4 client on a dual-stack socket as
       * `::ffff:203.0.113.10`. Without unwrapping, every postback from a
       * provider publishing ordinary IPv4 CIDRs is refused — on some
       * deployments and not others, which is the worst kind of failure.
       */
      await expect(
        intake.receive(envelope(conversionQuery(), { sourceIp: '::ffff:203.0.113.10' })),
      ).resolves.toEqual({ status: 'accepted' });
    });

    it('refuses an address outside it, before any archiving', async () => {
      await expect(
        intake.receive(envelope(conversionQuery(), { sourceIp: '198.51.100.1' })),
      ).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_SOURCE_NOT_ALLOWED,
        httpStatus: 403,
      });

      expect(await prisma.providerPostback.count()).toBe(0);
    });

    it('refuses an address it could not determine', async () => {
      // Allowing what cannot be checked turns a misconfigured `trust proxy`
      // into a silently disabled allowlist.
      await expect(
        intake.receive(envelope(conversionQuery(), { sourceIp: null })),
      ).rejects.toMatchObject({ code: ERROR_CODES.POSTBACK_SOURCE_NOT_ALLOWED });
    });

    it('does not check the source when no ranges are configured', async () => {
      await providers.update(providerId, { postbackIpRanges: [] });

      // The column's documented meaning, honoured rather than second-guessed:
      // an operator who has not filled it in gets a provider that works and a
      // signature check, not one that silently rejects everything.
      await expect(
        intake.receive(envelope(conversionQuery(), { sourceIp: '198.51.100.1' })),
      ).resolves.toEqual({ status: 'accepted' });
    });
  });

  describe('the signature', () => {
    it('refuses a forged signature and archives nothing', async () => {
      const query = { ...conversionQuery(), sig: 'f'.repeat(64) };

      await expect(intake.receive(envelope(query))).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_SIGNATURE_INVALID,
        httpStatus: 401,
      });

      /*
       * The endpoint is public and unauthenticated by necessity (§19.2). A
       * row written for unverified input is a table anyone who can type is
       * allowed to fill — so the archive begins only once we know a provider
       * sent it.
       */
      expect(await prisma.providerPostback.count()).toBe(0);
    });

    it('refuses a signature over different parameters', async () => {
      // The tamper this catches: a valid signature replayed onto a bigger
      // payout.
      const query = conversionQuery();
      const tampered = { ...query, payout: '999.00' };

      await expect(intake.receive(envelope(tampered))).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_SIGNATURE_INVALID,
      });
    });

    it('refuses a missing signature', async () => {
      const { sig: _sig, ...unsigned } = conversionQuery();

      await expect(intake.receive(envelope(unsigned))).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_SIGNATURE_INVALID,
      });
    });

    it('is checked before parsing, so a forgery cannot reach the parser', async () => {
      // Parsing an unverified payload to decide whether to verify it is how a
      // forged field gets read before it is trusted (§7.1).
      const query = { transaction_id: 'TX-FORGED', sig: 'nope' };

      await expect(intake.receive(envelope(query))).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_SIGNATURE_INVALID,
      });
    });
  });

  // --- Format drift --------------------------------------------------------

  describe('a postback that verified and will not parse', () => {
    /** Authentic — correctly signed — but missing what attribution needs. */
    const unparseable = () => sign({ campaign_id: 'MK-100241', status: '1' });

    it('is archived anyway, as evidence', async () => {
      await expect(intake.receive(envelope(unparseable()))).rejects.toMatchObject({
        code: ERROR_CODES.POSTBACK_PAYLOAD_INVALID,
        httpStatus: 400,
      });

      const stored = await prisma.providerPostback.findFirstOrThrow();

      /*
       * §10.1 parses before it inserts, which reads as "drop it". The same
       * section's stated reason for storing raw payloads is that processing
       * can have a bug — and parsing *is* processing. A provider renaming a
       * field would otherwise lose every conversion during the incident, with
       * no evidence any of them arrived, and those are conversions users
       * completed.
       *
       * Safe because it is past the signature check: only someone holding the
       * provider's secret can write these rows.
       */
      expect(stored.state).toBe(POSTBACK_STATES.REJECTED);
      expect(stored.externalTransactionId).toBeNull();
      expect(stored.errorDetail).toContain('sub_id');
    });

    it('is not enqueued — there is nothing to process', async () => {
      await intake.receive(envelope(unparseable())).catch(() => undefined);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed']);
      expect(jobs).toHaveLength(0);
    });

    it('does not collide with another unparseable one', async () => {
      /*
       * Two NULLs are never equal in PostgreSQL, so these rows never collide.
       * That is correct rather than a loophole: an unparseable payload has no
       * idempotency key to deduplicate on, and duplicating evidence is
       * harmless.
       */
      await intake.receive(envelope(unparseable())).catch(() => undefined);
      await intake.receive(envelope(unparseable())).catch(() => undefined);

      expect(await prisma.providerPostback.count()).toBe(2);
    });

    it('stores a one-line reason, never a stack trace', async () => {
      await intake.receive(envelope(unparseable())).catch(() => undefined);

      const stored = await prisma.providerPostback.findFirstOrThrow();

      // `error_detail` is shown to an admin (§15.3).
      expect(stored.errorDetail).not.toContain('\n');
      expect(stored.errorDetail!.length).toBeLessThanOrEqual(500);
    });
  });

  // --- What the archive keeps ----------------------------------------------

  describe('the archive', () => {
    it('captures the headers worth keeping and no credential', async () => {
      await intake.receive(
        envelope(conversionQuery(), {
          headers: {
            'user-agent': 'ProviderBot/1.0',
            authorization: 'Bearer provider-secret-token',
            cookie: 'session=secret',
          },
        }),
      );

      const stored = await prisma.providerPostback.findFirstOrThrow();

      // A secret in a database row is a secret in every backup, every
      // replica, and the blast radius of any SQL injection (DATABASE.md §1).
      expect(JSON.stringify(stored.headers)).not.toContain('provider-secret-token');
      expect(JSON.stringify(stored.headers)).toContain('ProviderBot/1.0');
    });

    it('records a POST body as it arrived', async () => {
      const query = conversionQuery();

      await intake.receive(
        envelope(query, { method: 'POST', body: { extra: 'provider-note' } }),
      );

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.payload).toMatchObject({
        method: 'POST',
        body: { extra: 'provider-note' },
      });
    });

    it('starts with no processing attempts and no error', async () => {
      await intake.receive(envelope(conversionQuery()));

      const stored = await prisma.providerPostback.findFirstOrThrow();
      expect(stored.processingAttempts).toBe(0);
      expect(stored.errorDetail).toBeNull();
    });
  });

  // --- Reads ---------------------------------------------------------------

  describe('reading the archive', () => {
    it('filters by state, provider and transaction id', async () => {
      const accepted = conversionQuery();
      await intake.receive(envelope(accepted));
      await intake
        .receive(envelope(sign({ campaign_id: 'MK-100241' })))
        .catch(() => undefined);

      await expect(
        intake.findMany({ state: POSTBACK_STATES.RECEIVED }),
      ).resolves.toMatchObject({ total: 1 });

      await expect(
        intake.findMany({ state: POSTBACK_STATES.REJECTED }),
      ).resolves.toMatchObject({ total: 1 });

      await expect(intake.findMany({ providerId })).resolves.toMatchObject({ total: 2 });

      // The reference a provider quotes in a dispute.
      await expect(
        intake.findMany({ externalTransactionId: accepted.transaction_id }),
      ).resolves.toMatchObject({ total: 1 });
    });

    it('reports a missing postback rather than returning nothing', async () => {
      await expect(
        intake.requireById('0192f0a0-0000-7000-8000-0000000000aa'),
      ).rejects.toMatchObject({ code: ERROR_CODES.POSTBACK_NOT_FOUND, httpStatus: 404 });
    });

    it('keeps the payload off the list view and on the detail view', async () => {
      await intake.receive(envelope(conversionQuery()));
      const stored = await prisma.providerPostback.findFirstOrThrow();

      const summary = intake.toSummary(stored, 'mock');
      const detail = intake.toDetail(stored, 'mock');

      expect('payload' in summary).toBe(false);
      expect(detail.payload).toMatchObject({ method: 'GET' });
    });
  });
});
