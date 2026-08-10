import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  type ListOffersQuery,
  type ListSyncRunsQuery,
  type OfferSummary,
  type Paginated,
  type SyncMode,
  type SyncRunSummary,
} from '@gemone/contracts';
import { Queue } from 'bullmq';

import { PrismaService } from '../../core/database/prisma.service';
import { CATALOG_JOBS, QUEUES } from '../../core/queue/queue.constants';
import { OffersService } from '../offers/offers.service';
import { SyncRunsService } from '../offers/sync-runs.service';
import { ProvidersService } from '../providers/providers.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminActionContext } from './admin-users.service';

/**
 * Administrative operations on the offer catalog.
 *
 * A composition layer (ARCHITECTURE.md §4.3). `OffersService` decides what a
 * valid activation is, `SyncRunsService` owns the history, `CatalogSyncService`
 * owns the pipeline; this shapes results for a screen and records who acted.
 *
 * The `offers` module has no HTTP surface of its own yet — its eventual one is
 * the user-facing wall. Putting the admin screens here keeps the two from
 * growing a shared controller whose two audiences slowly diverge.
 */
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OffersService,
    private readonly runs: SyncRunsService,
    private readonly providers: ProvidersService,
    private readonly audit: AdminAuditService,
    @InjectQueue(QUEUES.CATALOG) private readonly queue: Queue,
  ) {}

  async listOffers(query: ListOffersQuery): Promise<Paginated<OfferSummary>> {
    const page = await this.offers.findMany(query);
    const slugs = await this.slugsFor(page.items.map((offer) => offer.providerId));

    return {
      ...page,
      items: page.items.map((offer) =>
        OffersService.toSummary(offer, slugs.get(offer.providerId) ?? 'unknown'),
      ),
    };
  }

  async getOffer(id: string): Promise<OfferSummary> {
    const offer = await this.offers.requireById(id);
    const provider = await this.providers.requireById(offer.providerId);

    return OffersService.toSummary(offer, provider.slug);
  }

  /**
   * Switches one offer on or off, and records why.
   *
   * Both in one transaction (DATABASE.md §10.1). The failure that matters is
   * partial completion: an offer pulled with no audit entry is an offer that
   * disappeared for reasons nobody can reconstruct, and the person asking is
   * usually a user who was halfway through it.
   */
  async setOfferActive(
    id: string,
    active: boolean,
    reason: string,
    context: AdminActionContext,
  ): Promise<OfferSummary> {
    const before = await this.offers.requireById(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const offer = await this.offers.setActive(id, active, tx);

      await this.audit.record(tx, {
        adminId: context.adminId,
        action: active ? ADMIN_ACTIONS.OFFER_ACTIVATED : ADMIN_ACTIONS.OFFER_DEACTIVATED,
        targetType: 'offer',
        targetId: id,
        before: { isActive: before.isActive, deactivationSource: before.deactivationSource },
        after: { isActive: offer.isActive, deactivationSource: offer.deactivationSource },
        reason,
        ip: context.ip ?? null,
      });

      return offer;
    });

    const provider = await this.providers.requireById(updated.providerId);
    return OffersService.toSummary(updated, provider.slug);
  }

  async listSyncRuns(query: ListSyncRunsQuery): Promise<Paginated<SyncRunSummary>> {
    const page = await this.runs.findMany(query);
    const slugs = await this.slugsFor(page.items.map((run) => run.providerId));

    return {
      ...page,
      items: page.items.map((run) =>
        SyncRunsService.toSummary(run, slugs.get(run.providerId) ?? 'unknown'),
      ),
    };
  }

  /**
   * Enqueues a synchronization rather than running it inline.
   *
   * The request returns as soon as the job is accepted. Running a sync inside
   * the HTTP handler would hold a request open for however long a provider
   * takes to answer, put that latency on the API's event loop, and lose the
   * work entirely if the admin closed the tab — the exact reasons the worker
   * process exists (§1.2).
   *
   * The audit entry records the *request*, which is the administrative act.
   * What the sync then did is recorded by the run itself.
   */
  async requestSync(
    providerId: string,
    mode: SyncMode,
    reason: string | null,
    context: AdminActionContext,
  ): Promise<{ enqueued: true; providerId: string; mode: SyncMode }> {
    const provider = await this.providers.requireById(providerId);

    await this.audit.record(this.prisma, {
      adminId: context.adminId,
      action: ADMIN_ACTIONS.CATALOG_SYNC_REQUESTED,
      targetType: 'provider',
      targetId: providerId,
      after: { mode },
      reason,
      ip: context.ip ?? null,
    });

    await this.queue.add(
      CATALOG_JOBS.SYNC,
      { providerId, mode, requestedBy: context.adminId },
      {
        /*
         * No `jobId` here, deliberately — unlike the scheduled path.
         *
         * The tick deduplicates because a repeated tick is an accident. An
         * admin pressing "sync now" twice is a decision: they saw the first
         * result and want another run. Silently discarding it would look
         * exactly like the button being broken.
         */
        attempts: 1,
      },
    );

    this.logger.log(
      { adminId: context.adminId, providerId, slug: provider.slug, mode },
      'Admin requested a catalog sync',
    );

    return { enqueued: true, providerId, mode };
  }

  /**
   * Resolves provider slugs for a page in one query.
   *
   * §11.3 accepts several queries where one join would do, so that module
   * boundaries survive; this is that trade, kept to one extra query per page
   * rather than one per row.
   */
  private async slugsFor(providerIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(providerIds)];
    if (unique.length === 0) return new Map();

    const providers = await this.providers.findAll();

    return new Map(
      providers
        .filter((provider) => unique.includes(provider.id))
        .map((provider) => [provider.id, provider.slug]),
    );
  }
}
