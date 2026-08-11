import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES, OFFER_CATEGORIES, SYNC_MODES, WALL_OFFER_SORTS } from '@gemone/contracts';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '../../src/app.module';
import { ConfigurationService } from '../../src/core/config/configuration.service';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createValidationPipe } from '../../src/core/errors/validation-pipe';
import { CatalogSyncService } from '../../src/modules/offers/catalog-sync.service';
import { OffersService } from '../../src/modules/offers/offers.service';
import { ProvidersService } from '../../src/modules/providers/providers.service';

/**
 * Deliberately not something `'mock'` could be title-cased into — the point of
 * TODO T82 is that a display name is a stored fact, not a transform of a slug.
 */
const PROVIDER_DISPLAY_NAME = 'Mock Offerwall';

/**
 * The offer wall — PROJECT.md §3.2, milestone M2.
 *
 * **The invariant this file exists to hold:** every offer the wall shows is one
 * a click would be accepted for. A wall that lists something `POST /clicks`
 * refuses is not a cosmetic bug — the user picks it, gets a 409, and if the
 * refusal came later than that they would have done the work for a conversion
 * we cannot verify.
 */
/**
 * A fixed timestamp for the rows this file writes straight to the table.
 *
 * The lint rule refusing a zero-argument `new Date()` is right even in a test:
 * a fixture whose timestamp is "now" orders differently depending on how long
 * the suite took to get there, which is how a `newest` sort assertion becomes
 * intermittent.
 */
const SEEN_AT = new Date('2026-01-01T00:00:00.000Z');

describe('offer wall (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let providers: ProvidersService;
  let catalog: CatalogSyncService;
  let configuration: ConfigurationService;

  let providerId: string;

  const password = 'correct-horse-battery-staple';
  let counter = 0;
  const nextEmail = () => `wall-${++counter}.${Date.now()}@example.com`;

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

    const provider = await providers.create({ slug: 'mock', displayName: PROVIDER_DISPLAY_NAME });
    providerId = provider.id;
    await providers.setEnabled(providerId, true);
    await providers.reload();
    await catalog.sync(providerId, SYNC_MODES.FULL);
  });

  const server = () => app.getHttpServer();

  // --- The invariant -------------------------------------------------------

  describe('everything on the wall can be clicked', () => {
    it('accepts a click on every offer the wall returned', async () => {
      /*
       * The whole feature in one assertion. Not "the wall returns rows" but
       * "the wall and the click endpoint agree" — which is the property the
       * eligibility filter exists to produce, and the one that breaks silently
       * if either side grows its own copy of the rule.
       */
      const user = await createUser();
      const wall = await get(user, '/offers').expect(200);

      expect(wall.body.items.length).toBeGreaterThan(0);

      for (const offer of wall.body.items) {
        await request(server())
          .post('/clicks')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ offerId: offer.id })
          .expect(201);
      }
    });
  });

  // --- Eligibility ---------------------------------------------------------

  describe('eligibility', () => {
    it('hides an offer an admin deactivated', async () => {
      const user = await createUser();
      const before = await get(user, '/offers').expect(200);
      const target = before.body.items[0];

      await prisma.offer.update({
        where: { id: target.id },
        data: { isActive: false, deactivationSource: 'ADMIN' },
      });

      const after = await get(user, '/offers').expect(200);
      expect(after.body.items.map((o: { id: string }) => o.id)).not.toContain(target.id);
      expect(after.body.total).toBe(before.body.total - 1);
    });

    it('empties the wall when the provider is disabled', async () => {
      /*
       * §7.3: "cutting off a misbehaving provider takes seconds and no
       * deploy." The wall is where a user would notice, and since §14.3 it is
       * true on every process rather than the one the admin reached.
       */
      const user = await createUser();
      expect((await get(user, '/offers').expect(200)).body.total).toBeGreaterThan(0);

      await providers.setEnabled(providerId, false);
      await providers.reload();

      const after = await get(user, '/offers').expect(200);
      expect(after.body.items).toEqual([]);
      expect(after.body.total).toBe(0);

      // The rows are still there. The wall is a view, not a deletion.
      expect(await prisma.offer.count({ where: { isActive: true } })).toBeGreaterThan(0);
    });

    it('hides a provider that is enabled in the database but has no usable adapter', async () => {
      /*
       * **The test that decides how eligibility is computed.**
       *
       * This provider row says `is_enabled = true`, so a SQL filter on that
       * column would put its offers on the wall. The registry refuses it
       * anyway, because this build has no adapter for the slug — and so does
       * `ClicksService`, via `registry.require`. A user sent to one of these
       * offers would complete it and produce a postback nothing can verify.
       *
       * Written straight to the table because `ProvidersService.create`
       * refuses an unknown slug at the boundary — which is the correct
       * behaviour and is exactly why this state can only arise from a slug
       * being removed from the code beneath an existing row.
       */
      const orphanId = uuidv7();
      await prisma.provider.create({
        data: {
          id: orphanId,
          slug: 'removed-network',
          displayName: 'A network this build no longer has an adapter for',
          isEnabled: true,
        },
      });
      await prisma.offer.create({
        data: {
          id: uuidv7(),
          providerId: orphanId,
          externalId: 'ORPHAN-1',
          title: 'An offer nobody can verify a postback for',
          payoutAmountMinor: 10_000,
          payoutCurrency: 'USD',
          rewardPoints: 999_999,
          category: OFFER_CATEGORIES.GAME,
          providerCategories: [],
          countries: [],
          devices: [],
          trackingUrlTemplate: 'https://example.test/click?s={SUB_ID}',
          isActive: true,
          lastSeenAt: SEEN_AT,
        },
      });
      await providers.reload();

      const user = await createUser();
      const wall = await get(user, '/offers').expect(200);

      // It pays the most, so it would sort first if it were eligible at all.
      expect(wall.body.items.map((o: { id: string }) => o.title)).not.toContain(
        'An offer nobody can verify a postback for',
      );

      // And the click endpoint agrees, which is the point.
      const orphanOffer = await prisma.offer.findFirstOrThrow({
        where: { externalId: 'ORPHAN-1' },
      });
      await request(server())
        .post('/clicks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ offerId: orphanOffer.id })
        .expect(409);
    });
  });

  // --- What a user may see -------------------------------------------------

  describe('the response body', () => {
    it('never carries what the provider pays us', async () => {
      /*
       * The unit assertion covers the serialiser; this covers the whole
       * pipeline, because a leak could equally come from an interceptor or a
       * future response envelope.
       */
      const user = await createUser();
      const wall = await get(user, '/offers').expect(200);
      const body = JSON.stringify(wall.body);

      expect(body).not.toContain('payoutAmountMinor');
      expect(body).not.toContain('payoutCurrency');
      expect(body).not.toContain('trackingUrlTemplate');

      // The one number a user is shown is present, so this cannot pass by the
      // response being empty.
      expect(wall.body.items[0].rewardPoints).toBeGreaterThan(0);
    });

    it('carries what a card needs and nothing internal', async () => {
      const user = await createUser();
      const [offer] = (await get(user, '/offers').expect(200)).body.items;

      expect(Object.keys(offer).sort()).toEqual([
        'category',
        'countries',
        'description',
        'devices',
        'id',
        'imageUrl',
        'isMultiStep',
        'providerName',
        'providerSlug',
        'requirements',
        'rewardPoints',
        'title',
      ]);
    });

    /**
     * TODO T82. The wall used to carry a slug and nothing else, so every
     * client had to title-case it — `adgem` became "Adgem". The name now comes
     * from `providers.display_name`, resolved from the registry snapshot the
     * wall already consults.
     */
    it('names the provider as an admin named it, not as its slug', async () => {
      const user = await createUser();
      const { body } = await get(user, '/offers').expect(200);

      for (const offer of body.items) {
        expect(offer.providerSlug).toBe('mock');
        // The row's display name, which the fixture sets to something a slug
        // could not be title-cased into.
        expect(offer.providerName).toBe(PROVIDER_DISPLAY_NAME);
        expect(offer.providerName).not.toBe(offer.providerSlug);
      }
    });

    it('names the provider on the detail view too', async () => {
      const user = await createUser();
      const [first] = (await get(user, '/offers').expect(200)).body.items;
      const { body } = await get(user, `/offers/${first.id}`).expect(200);

      expect(body.providerName).toBe(PROVIDER_DISPLAY_NAME);
      expect(body.providerSlug).toBe('mock');
    });
  });

  // --- Filtering, sorting, paging -----------------------------------------

  describe('filtering', () => {
    it('narrows by category', async () => {
      const user = await createUser();
      const all = await get(user, '/offers').expect(200);
      const category = all.body.items[0].category;

      const filtered = await get(user, `/offers?category=${category}`).expect(200);

      expect(filtered.body.items.length).toBeGreaterThan(0);
      expect(
        filtered.body.items.every((o: { category: string }) => o.category === category),
      ).toBe(true);
    });

    it('searches the title, case-insensitively', async () => {
      const user = await createUser();
      const [first] = (await get(user, '/offers').expect(200)).body.items;
      const needle = first.title.slice(0, 6).toUpperCase();

      const found = await get(user, `/offers?search=${encodeURIComponent(needle)}`).expect(200);

      expect(found.body.items.map((o: { id: string }) => o.id)).toContain(first.id);
    });

    it('bounds the reward range inclusively', async () => {
      const user = await createUser();
      const items = (await get(user, '/offers').expect(200)).body.items as {
        rewardPoints: number;
      }[];
      const exact = items[0].rewardPoints;

      const filtered = await get(
        user,
        `/offers?minRewardPoints=${exact}&maxRewardPoints=${exact}`,
      ).expect(200);

      expect(filtered.body.items.length).toBeGreaterThan(0);
      expect(
        filtered.body.items.every((o: { rewardPoints: number }) => o.rewardPoints === exact),
      ).toBe(true);
    });

    it('treats an unknown country as an empty wall, not an error', async () => {
      /*
       * Which countries a provider targets is the provider's business and
       * changes without telling us. A 422 here would make the client's filter
       * list a thing we have to keep in step with every network.
       */
      const user = await createUser();
      const response = await get(user, '/offers?country=ZZ').expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('rejects a malformed country code', async () => {
      const user = await createUser();
      await get(user, '/offers?country=UNITED-STATES').expect(422);
    });

    it('rejects an unknown sort rather than silently ignoring it', async () => {
      // An ignored sort parameter is a client that believes it is sorting.
      const user = await createUser();
      await get(user, '/offers?sort=payout_desc').expect(422);
    });
  });

  describe('sorting and paging', () => {
    beforeEach(async () => {
      // Enough rows, with deliberate reward ties, to make an unstable sort
      // visible.
      for (let index = 0; index < 6; index += 1) {
        await prisma.offer.create({
          data: {
            id: uuidv7(),
            providerId,
            externalId: `PAGE-${index}`,
            title: `Paged offer ${index}`,
            payoutAmountMinor: 100,
            payoutCurrency: 'USD',
            rewardPoints: 500,
            category: OFFER_CATEGORIES.SURVEY,
            providerCategories: [],
            countries: [],
            devices: [],
            trackingUrlTemplate: 'https://example.test/click?s={SUB_ID}',
            isActive: true,
            lastSeenAt: SEEN_AT,
          },
        });
      }
    });

    it('orders by reward, highest first, by default', async () => {
      const user = await createUser();
      const points = (await get(user, '/offers').expect(200)).body.items.map(
        (o: { rewardPoints: number }) => o.rewardPoints,
      );

      expect(points).toEqual([...points].sort((a: number, b: number) => b - a));
    });

    it('reverses on request', async () => {
      const user = await createUser();
      const points = (
        await get(user, `/offers?sort=${WALL_OFFER_SORTS.REWARD_ASC}`).expect(200)
      ).body.items.map((o: { rewardPoints: number }) => o.rewardPoints);

      expect(points).toEqual([...points].sort((a: number, b: number) => a - b));
    });

    it('pages without repeating or skipping an offer, even across reward ties', async () => {
      /*
       * Six of these offers pay exactly the same. Without a unique tiebreaker
       * the database may order tied rows differently between two queries, and
       * a user paging the wall sees one offer twice and never sees another —
       * which reads as missing inventory, not as a sort problem.
       */
      const user = await createUser();
      const total = (await get(user, '/offers?limit=1').expect(200)).body.total;

      const seen: string[] = [];
      for (let offset = 0; offset < total; offset += 2) {
        const page = await get(user, `/offers?limit=2&offset=${offset}`).expect(200);
        seen.push(...page.body.items.map((o: { id: string }) => o.id));
      }

      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    });

    it('caps the page size', async () => {
      const user = await createUser();
      await get(user, '/offers?limit=5000').expect(422);
    });
  });

  // --- Cross-provider paging -----------------------------------------------

  /**
   * The regression guard for the tiebreaker.
   *
   * The paging test above runs against one provider, and that is exactly why it
   * could not catch this: `externalId` is unique per
   * `@@unique([providerId, externalId])`, so with a single provider it is unique
   * table-wide and an ordering ending in it *looks* deterministic. Two providers
   * shipping the same identifier at the same reward tie on every sort key, and
   * the page boundary starts repeating one offer and dropping the other.
   *
   * Driven through `OffersService.findForWall` rather than over HTTP because the
   * wall's eligible ids arrive as an argument, while the HTTP path takes them
   * from `ProviderRegistry` — and the registry can only register slugs this
   * build has an adapter for, of which there is currently one. Testing the
   * ordering where the ordering lives keeps the test about the ordering.
   */
  describe('paging across providers with colliding identifiers', () => {
    /**
     * Six identifiers, each shipped by *both* providers — twelve rows in six
     * colliding pairs.
     *
     * One pair is enough to describe the bug and too few to catch it reliably.
     * Whether a tie actually comes back in a different order depends on the
     * physical row order the scan happens to see, so a single pair is close to a
     * coin flip: reverting the fix failed three of these tests on one run and
     * four on the next, with a different sort surviving each time. Six pairs and
     * a page-by-page walk turn "the defect is usually visible" into "the defect
     * has to hide six times in a row".
     */
    const PAIRS = 6;
    const TIED_REWARD = 500;

    let secondProviderId: string;
    let eligible: string[];

    beforeEach(async () => {
      /*
       * Written straight to the table: `ProvidersService.create` validates the
       * slug against the adapter map, and a second usable adapter does not
       * exist yet. The row is all this test needs — `findForWall` takes the
       * eligible ids as an argument.
       */
      const second = await prisma.provider.create({
        data: { id: uuidv7(), slug: 'second', displayName: 'Second Network' },
      });
      secondProviderId = second.id;
      eligible = [providerId, secondProviderId];

      // Only the tied rows, so a page of one is unambiguous.
      await prisma.offer.deleteMany();

      /*
       * Created in *descending* identifier order, deliberately.
       *
       * `id` is a uuidv7, so creation order is id order — and creating
       * `1001` first would make id order and `externalId` order the same
       * sequence. Every assertion below would then hold under either
       * tiebreaker, and the tests would agree with the fix by coincidence
       * rather than by testing it. Descending makes the two orders opposites,
       * so an ordering that fell back to `externalId` is visibly wrong.
       */
      for (let index = PAIRS; index >= 1; index -= 1) {
        for (const owner of eligible) {
          await prisma.offer.create({
            data: {
              id: uuidv7(),
              providerId: owner,
              externalId: String(1000 + index),
              title: `Offer ${index} from ${owner}`,
              payoutAmountMinor: 100,
              payoutCurrency: 'USD',
              rewardPoints: TIED_REWARD,
              category: OFFER_CATEGORIES.SURVEY,
              providerCategories: [],
              countries: [],
              devices: [],
              trackingUrlTemplate: 'https://example.test/click?s={SUB_ID}',
              isActive: true,
              lastSeenAt: SEEN_AT,
              /*
               * Pinned, so the rows tie on `newest` as well. Left to default
               * the rows get distinct insertion timestamps, `newest` is decided
               * before it ever reaches the tiebreaker, and that parametrization
               * silently tests nothing — it passed against the broken ordering.
               */
              createdAt: SEEN_AT,
            },
          });
        }
      }
    });

    const TOTAL = PAIRS * 2;

    it.each(Object.values(WALL_OFFER_SORTS))(
      'partitions the tied rows across pages while a sync writes between them (%s)',
      async (sort) => {
        const offers = app.get(OffersService);
        const seen: string[] = [];

        for (let offset = 0; offset < TOTAL; offset += 1) {
          const page = await offers.findForWall({ sort, limit: 1, offset }, eligible);
          expect(page.total).toBe(TOTAL);
          expect(page.items).toHaveLength(1);
          seen.push(page.items[0].id);

          /*
           * A write between every page, and it is not contrived: this is what
           * `upsertFromSync` does to every offer on every run. The UPDATE
           * writes a new tuple at the end of the heap, so the next scan meets
           * the rows in a different physical order — and where they tie on
           * every ORDER BY key, nothing puts them back.
           */
          await prisma.offer.update({
            where: { id: page.items[0].id },
            data: { lastSeenAt: new Date(SEEN_AT.getTime() + offset + 1) },
          });
        }

        // The property that matters, and the one the old ordering broke: the
        // pages partition the result set. Nothing repeats, nothing is lost.
        expect(new Set(seen).size).toBe(TOTAL);
      },
    );

    it('returns the tied rows in the same order across a full sync', async () => {
      const offers = app.get(OffersService);

      const before = await offers.findForWall({ limit: TOTAL }, eligible);
      expect(before.items).toHaveLength(TOTAL);

      /*
       * Every row rewritten, one at a time — a full sync run, which is the
       * ordinary state of this table rather than an unusual one.
       *
       * Touching a single row is too weak to be a guard: it leaves eleven of
       * twelve tuples where they were, the scan order barely moves, and the
       * assertion below held even against the broken ordering. Rewriting all of
       * them is both more realistic and the thing that actually distinguishes a
       * unique sort key from a lucky one.
       */
      for (const [index, offer] of before.items.entries()) {
        await prisma.offer.update({
          where: { id: offer.id },
          data: { lastSeenAt: new Date(SEEN_AT.getTime() + index + 1) },
        });
      }

      const after = await offers.findForWall({ limit: TOTAL }, eligible);

      // Determinism itself, stated directly: the sort key set is unique, so
      // rewriting every row cannot reorder the result.
      expect(after.items.map((offer) => offer.id)).toEqual(
        before.items.map((offer) => offer.id),
      );
    });

    it('breaks the tie by id, so the ordering is the one the code documents', async () => {
      const offers = app.get(OffersService);

      const page = await offers.findForWall({ limit: TOTAL }, eligible);
      const ids = page.items.map((offer) => offer.id);

      /*
       * Not merely stable — stable *in the documented direction*. `id: 'desc'`
       * would satisfy every assertion above while contradicting the comment on
       * `wallOrderBy` and the cursor T57 will build on it.
       *
       * This is also why the fixture is created in descending identifier order:
       * ascending `id` and ascending `externalId` are opposite sequences here,
       * so a tiebreaker that fell back to `externalId` fails this outright
       * instead of passing by coincidence.
       */
      expect(ids).toEqual([...ids].sort());
    });
  });

  // --- Detail --------------------------------------------------------------

  describe('one offer', () => {
    it('returns it', async () => {
      const user = await createUser();
      const [first] = (await get(user, '/offers').expect(200)).body.items;

      const detail = await get(user, `/offers/${first.id}`).expect(200);

      expect(detail.body).toEqual(first);
    });

    it('is a 404 for an offer that was deactivated, not a 409', async () => {
      /*
       * A browsing user has no legitimate way to act on the difference between
       * "no such offer" and "withdrawn", and distinguishing them makes the
       * wall an oracle for which providers we run. `ClicksService` answers 409
       * because there the user has chosen something.
       */
      const user = await createUser();
      const [first] = (await get(user, '/offers').expect(200)).body.items;
      await prisma.offer.update({ where: { id: first.id }, data: { isActive: false } });

      const response = await get(user, `/offers/${first.id}`).expect(404);
      expect(response.body.error.code).toBe(ERROR_CODES.OFFER_NOT_FOUND);
    });

    it('is a 404 when the provider behind it is disabled', async () => {
      const user = await createUser();
      const [first] = (await get(user, '/offers').expect(200)).body.items;

      await providers.setEnabled(providerId, false);
      await providers.reload();

      await get(user, `/offers/${first.id}`).expect(404);
    });

    it('answers 422 for a malformed id, not 400', async () => {
      const user = await createUser();
      await get(user, '/offers/not-a-uuid').expect(422);
    });

    it('answers 404 for a well-formed id that does not exist', async () => {
      const user = await createUser();
      await get(user, `/offers/${uuidv7()}`).expect(404);
    });
  });

  // --- Authentication ------------------------------------------------------

  describe('authentication', () => {
    it('refuses an anonymous request', async () => {
      /*
       * The wall is the aggregated catalog. Anonymous, it is a free copy of
       * every provider's inventory for anyone who finds the URL — and a click
       * needs a user anyway.
       */
      await request(server()).get('/offers').expect(401);
      await request(server()).get(`/offers/${uuidv7()}`).expect(401);
    });

    it('refuses a suspended user', async () => {
      const user = await createUser();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      await get(user, '/offers').expect(403);
    });
  });

  // --- Helpers -------------------------------------------------------------

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

  function get(caller: Caller, path: string) {
    return request(server()).get(path).set('Authorization', `Bearer ${caller.token}`);
  }
});
