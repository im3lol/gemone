import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  OFFER_DEACTIVATION_SOURCES,
  WALL_OFFER_SORTS,
  type ListOffersQuery,
  type ListWallOffersQuery,
  type OfferSummary,
  type Paginated,
  type WallOffer,
  type WallOfferSort,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { Offer, Prisma } from '../../generated/prisma/client';
import type { MappedOffer } from './internal/offer-normalizer';
import { Inject } from '@nestjs/common';

/** Whether an upsert created a row or updated one. Fed into the run's counts. */
export interface UpsertOutcome {
  created: boolean;
}

/**
 * Owner of the `offers` table — DATABASE.md §11.
 *
 * The catalog's storage and read surface. Synchronization *policy* — what to
 * fetch, when, and whether a run may prune — lives in `CatalogSyncService`;
 * this holds the operations that touch rows, so that the policy is readable
 * without wading through Prisma calls and each is testable on its own.
 */
/**
 * The two facts the wall needs about the provider behind an offer.
 *
 * A structural type rather than `RegisteredProvider`, so this module stays
 * free of the registry's shape — `offers` owns the catalog and knows nothing
 * about adapters. `OfferWallService` supplies it from the snapshot it already
 * holds, which is why the display name costs no query (TODO T82).
 */
export interface WallProvider {
  slug: string;
  displayName: string;
}

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Sync-facing writes -------------------------------------------------

  /**
   * Writes one offer, creating or updating.
   *
   * **One transaction per offer, not one per batch** (§12.2, rule 3). A batch
   * transaction over a ten-thousand-offer catalog holds locks for its whole
   * duration and throws away every row's progress when any single one fails —
   * so a provider shipping one malformed record costs the entire sync. An
   * upsert is already atomic, so no explicit transaction is needed here at
   * all, which is the cheapest form of that rule.
   *
   * **Reactivation is conditional.** A sync may only undo a deactivation that
   * a sync performed. An offer an admin pulled stays pulled even though the
   * provider still lists it — otherwise "remove this offer" would silently
   * mean "remove it until the next sync", which is not what anyone asking for
   * it means.
   */
  async upsertFromSync(
    providerId: string,
    mapped: MappedOffer,
    seenAt: Date,
  ): Promise<UpsertOutcome> {
    const existing = await this.prisma.offer.findUnique({
      where: { providerId_externalId: { providerId, externalId: mapped.externalId } },
      select: { id: true, isActive: true, deactivationSource: true },
    });

    const adminDeactivated =
      existing?.isActive === false &&
      existing.deactivationSource === OFFER_DEACTIVATION_SOURCES.ADMIN;

    const activation = adminDeactivated
      ? {}
      : { isActive: true, deactivatedAt: null, deactivationSource: null };

    await this.prisma.offer.upsert({
      where: { providerId_externalId: { providerId, externalId: mapped.externalId } },
      create: {
        id: uuidv7(),
        providerId,
        ...toColumns(mapped),
        isActive: true,
        lastSeenAt: seenAt,
      },
      update: {
        ...toColumns(mapped),
        ...activation,
        lastSeenAt: seenAt,
      },
    });

    return { created: existing === null };
  }

  /**
   * Deactivates this provider's offers that the current run did not touch.
   *
   * Expressed as `last_seen_at < runStartedAt` rather than by diffing id sets:
   * the timestamp comparison is a single indexed statement, and it stays
   * correct if a run is retried or overlaps, where a set difference computed
   * in memory would not.
   *
   * Scoped to `deactivationSource IS NULL` — that is, only offers that are
   * currently active — and it stamps SYNC so a later run may undo it. It never
   * touches an admin's decision.
   */
  async deactivateUnseen(
    providerId: string,
    runStartedAt: Date,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const result = await client.offer.updateMany({
      where: { providerId, isActive: true, lastSeenAt: { lt: runStartedAt } },
      data: {
        isActive: false,
        deactivatedAt: this.clock.now(),
        deactivationSource: OFFER_DEACTIVATION_SOURCES.SYNC,
      },
    });

    if (result.count > 0) {
      this.logger.log(
        { providerId, deactivated: result.count },
        'Offers deactivated: absent from a full sync',
      );
    }

    return result.count;
  }

  /** How many of this provider's offers are live. The denominator of the prune guard. */
  async countActive(providerId: string): Promise<number> {
    return this.prisma.offer.count({ where: { providerId, isActive: true } });
  }

  // --- Administration -----------------------------------------------------

  /**
   * An admin switching one offer on or off.
   *
   * Records ADMIN as the source, which is what makes the decision survive the
   * next sync. Reactivating clears the source entirely, returning the offer to
   * ordinary sync-managed life rather than pinning it on.
   */
  async setActive(
    id: string,
    active: boolean,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Offer> {
    const offer = await client.offer.findUnique({ where: { id } });
    if (!offer) throw offerNotFound(id);

    if (offer.isActive === active) {
      throw new DomainError(
        ERROR_CODES.OFFER_INVALID_STATE_TRANSITION,
        `Offer is already ${active ? 'active' : 'inactive'}`,
        409,
        { id },
      );
    }

    return client.offer.update({
      where: { id },
      data: active
        ? { isActive: true, deactivatedAt: null, deactivationSource: null }
        : {
            isActive: false,
            deactivatedAt: this.clock.now(),
            deactivationSource: OFFER_DEACTIVATION_SOURCES.ADMIN,
          },
    });
  }

  // --- Reads --------------------------------------------------------------

  async findMany(query: ListOffersQuery): Promise<Paginated<Offer>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.OfferWhereInput = {
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.country ? { countries: { has: query.country.toUpperCase() } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        // Ends with `id` for the same reason the wall's ordering does — see
        // `wallOrderBy`. The admin catalog spans every provider by default, so
        // this list reaches the cross-provider tie before the wall does.
        orderBy: [{ rewardPoints: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * The offer wall — PROJECT.md §3.2, milestone M2.
   *
   * ## Eligibility is not re-implemented here
   *
   * The caller passes the provider ids that may appear, and it gets them from
   * `ProviderRegistry` — the same object `ClicksService.create` consults before
   * it will issue a redirect. That is the point: the wall shows an offer if and
   * only if a click on it would be accepted.
   *
   * Written the other way round — `provider.isEnabled` in SQL — the wall would
   * be *almost* right. The registry refuses two kinds of provider, and only one
   * of them is a column: a disabled provider (§7.3), and one whose adapter
   * could not be built because a credential is missing from this deployment.
   * The second is invisible to the database, so a SQL filter would list offers
   * whose click is guaranteed to fail with `PROVIDER_UNKNOWN_SLUG` — the user
   * does the work, the postback cannot be verified, and it is quarantined.
   * Taking the ids from the registry makes the two surfaces agree by
   * construction rather than by two copies of one rule that drift.
   *
   * It also costs no query. The registry is an in-memory snapshot precisely so
   * that the hot paths do not pay for it, and since §14.3 it is kept fresh
   * across processes rather than only on the one that made the change.
   */
  async findForWall(
    query: ListWallOffersQuery,
    eligibleProviderIds: readonly string[],
  ): Promise<Paginated<Offer>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    /*
     * No eligible provider means an empty wall, and the query is skipped
     * rather than issued with an empty `in`. Prisma turns `in: []` into a
     * predicate that matches nothing, so the result would be the same — but
     * this way a platform with every provider disabled costs no database work
     * per request, which is exactly the state in which something is already
     * wrong.
     */
    if (eligibleProviderIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    const where: Prisma.OfferWhereInput = {
      providerId: { in: [...eligibleProviderIds] },
      // Never negotiable, and never a parameter. An inactive offer is one the
      // provider withdrew or an admin pulled, and `ClicksService` refuses it.
      isActive: true,

      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.country ? { countries: { has: query.country.toUpperCase() } } : {}),
      ...(query.device ? { devices: { has: query.device.toLowerCase() } } : {}),
      ...(query.minRewardPoints === undefined && query.maxRewardPoints === undefined
        ? {}
        : {
            rewardPoints: {
              ...(query.minRewardPoints === undefined ? {} : { gte: query.minRewardPoints }),
              ...(query.maxRewardPoints === undefined ? {} : { lte: query.maxRewardPoints }),
            },
          }),
    };

    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        orderBy: wallOrderBy(query.sort),
        take: limit,
        skip: offset,
      }),
      this.prisma.offer.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findById(id: string): Promise<Offer | null> {
    return this.prisma.offer.findUnique({ where: { id } });
  }

  async requireById(id: string): Promise<Offer> {
    const offer = await this.findById(id);
    if (!offer) throw offerNotFound(id);
    return offer;
  }

  /**
   * Shapes a row for the API — §19.3, an allowlist.
   *
   * `payoutAmountMinor` is included because every current caller is
   * admin-only. When a user-facing wall lands it needs its own serialiser
   * without it: what a provider pays us is our commercial relationship, not
   * something a user gets to see next to what they earn.
   */
  static toSummary(offer: Offer, providerSlug: string): OfferSummary {
    return {
      id: offer.id,
      providerId: offer.providerId,
      providerSlug,
      externalId: offer.externalId,
      title: offer.title,
      description: offer.description,
      requirements: offer.requirements,
      payoutAmountMinor: offer.payoutAmountMinor,
      payoutCurrency: offer.payoutCurrency,
      rewardPoints: offer.rewardPoints,
      category: offer.category,
      providerCategories: offer.providerCategories,
      countries: offer.countries,
      devices: offer.devices,
      imageUrl: offer.imageUrl,
      isMultiStep: offer.isMultiStep,
      isActive: offer.isActive,
      deactivatedAt: offer.deactivatedAt?.toISOString() ?? null,
      deactivationSource: offer.deactivationSource,
      lastSeenAt: offer.lastSeenAt.toISOString(),
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    };
  }

  /**
   * Shapes a row for the **wall** — the serialiser the comment on `toSummary`
   * said this feature would need.
   *
   * Written out field by field rather than deleting keys from `toSummary`'s
   * result, and that is the whole safety property: a column added to `offers`
   * and threaded into `OfferSummary` for an admin screen cannot reach a user
   * unless somebody writes it here. Subtracting would default to exposure and
   * fail silently; adding defaults to secrecy and fails visibly, as a missing
   * field on a screen.
   *
   * `payoutAmountMinor`, `payoutCurrency` and `trackingUrlTemplate` are the
   * three that must never appear — see `WallOffer`, and the assertion in
   * `offers-wall.arch.spec.ts` that fails if any of them is referenced here.
   */
  static toWallOffer(offer: Offer, provider: WallProvider): WallOffer {
    return {
      id: offer.id,
      providerSlug: provider.slug,
      providerName: provider.displayName,
      title: offer.title,
      description: offer.description,
      requirements: offer.requirements,
      rewardPoints: offer.rewardPoints,
      category: offer.category,
      countries: offer.countries,
      devices: offer.devices,
      imageUrl: offer.imageUrl,
      isMultiStep: offer.isMultiStep,
    };
  }
}

/**
 * Maps the closed sort set onto columns.
 *
 * Every ordering ends with `id` so a page boundary is deterministic. Without a
 * unique tiebreaker, two offers paying the same points can swap places between
 * two queries and a user paging through the wall sees one offer twice and never
 * sees another — the classic unstable-sort pagination bug, which looks like
 * missing inventory rather than like a sort problem.
 *
 * **`id` and not `externalId`, which is what this used to be.** `externalId` is
 * unique per `@@unique([providerId, externalId])` — that is, *within* a
 * provider. On a single-provider deployment it happens to be unique table-wide
 * and the ordering is stable by accident; the moment a second provider ships an
 * offer with the same identifier at the same reward, the two rows tie on every
 * sort key and the bug the tiebreaker exists to prevent comes back. Which is a
 * near certainty on an aggregator: `1001` is a plausible identifier at any
 * network, and rewards are derived and cluster.
 *
 * `id` is the primary key and a uuidv7, so it is globally unique *and* ordered
 * by creation — the tie is broken by which offer we saw first, which is the
 * least surprising answer available, and it is the keyset a cursor would use
 * (TODO T57).
 */
function wallOrderBy(sort: WallOfferSort | undefined): Prisma.OfferOrderByWithRelationInput[] {
  switch (sort) {
    case WALL_OFFER_SORTS.REWARD_ASC:
      return [{ rewardPoints: 'asc' }, { id: 'asc' }];
    case WALL_OFFER_SORTS.NEWEST:
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    case WALL_OFFER_SORTS.REWARD_DESC:
    default:
      return [{ rewardPoints: 'desc' }, { id: 'asc' }];
  }
}

/** The columns a sync writes. Shared by create and update so the two cannot drift. */
function toColumns(mapped: MappedOffer) {
  return {
    externalId: mapped.externalId,
    title: mapped.title,
    description: mapped.description,
    requirements: mapped.requirements,
    payoutAmountMinor: mapped.payoutAmountMinor,
    payoutCurrency: mapped.payoutCurrency,
    rewardPoints: mapped.rewardPoints,
    category: mapped.category,
    providerCategories: mapped.providerCategories,
    countries: mapped.countries,
    devices: mapped.devices,
    imageUrl: mapped.imageUrl,
    trackingUrlTemplate: mapped.trackingUrlTemplate,
    isMultiStep: mapped.isMultiStep,
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

function offerNotFound(id: string): DomainError {
  return new DomainError(ERROR_CODES.OFFER_NOT_FOUND, 'Offer not found', 404, { id });
}

export const __testing = { clampLimit, toColumns, DEFAULT_LIMIT, MAX_LIMIT };
