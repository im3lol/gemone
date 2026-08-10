import { Injectable } from '@nestjs/common';
import {
  SYNC_OUTCOMES,
  type ListSyncRunsQuery,
  type OfferRejectionReason,
  type Paginated,
  type SyncMode,
  type SyncOutcome,
  type SyncRunSummary,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '../../core/database/prisma.service';
import { CLOCK, type Clock } from '../../core/time/clock';
import { Inject } from '@nestjs/common';
import { Prisma, type OfferSyncRun } from '../../generated/prisma/client';

/** Everything a finished run records. */
export interface SyncRunResult {
  outcome: SyncOutcome;
  offersFetched: number;
  offersAccepted: number;
  offersRejected: number;
  offersCreated: number;
  offersUpdated: number;
  offersDeactivated: number;
  rejections: Partial<Record<OfferRejectionReason, number>>;
  errorSummary?: string | null;
}

/**
 * Owner of `offer_sync_runs` — the synchronization history (DATABASE.md §3.2).
 *
 * Separate from `OffersService` because it answers a different question and
 * has a different lifetime: offers are current state, overwritten by each
 * sync; runs are an append-only record with bounded retention, read by an
 * admin asking why the catalog changed.
 *
 * "Why did this provider's offers disappear at 3 a.m.?" gets asked, and logs
 * will have rotated by then — which is why this is a table and not a log
 * stream (§16.5).
 */
@Injectable()
export class SyncRunsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Opens a run, before any work happens.
   *
   * The ordering is the point. A run recorded only on completion is a run that
   * is invisible exactly when it matters — when the process died halfway
   * through and nobody knows whether the catalog is half-written. Opening
   * first means a crash leaves a RUNNING row with a start time and a provider,
   * which is the difference between "the sync failed at 03:12" and silence
   * (§12.2, rule 5).
   */
  async start(providerId: string, mode: SyncMode): Promise<OfferSyncRun> {
    return this.prisma.offerSyncRun.create({
      data: {
        id: uuidv7(),
        providerId,
        mode,
        outcome: SYNC_OUTCOMES.RUNNING,
        startedAt: this.clock.now(),
      },
    });
  }

  /** Closes a run with its counts. */
  async finish(runId: string, result: SyncRunResult): Promise<OfferSyncRun> {
    return this.prisma.offerSyncRun.update({
      where: { id: runId },
      data: {
        outcome: result.outcome,
        finishedAt: this.clock.now(),
        offersFetched: result.offersFetched,
        offersAccepted: result.offersAccepted,
        offersRejected: result.offersRejected,
        offersCreated: result.offersCreated,
        offersUpdated: result.offersUpdated,
        offersDeactivated: result.offersDeactivated,
        rejections:
          Object.keys(result.rejections).length === 0
            ? Prisma.DbNull
            : (result.rejections as Prisma.InputJsonValue),
        errorSummary: result.errorSummary ?? null,
      },
    });
  }

  /**
   * When this provider last completed an authoritative run.
   *
   * Drives the full-sync-due decision. Reads the *run history* rather than a
   * column on the provider row: a timestamp on the provider would have to be
   * kept in step by every code path that syncs, and the history already knows.
   */
  async lastSuccessfulFullSyncAt(providerId: string): Promise<Date | null> {
    const run = await this.prisma.offerSyncRun.findFirst({
      where: {
        providerId,
        mode: 'FULL',
        // PARTIAL counts: it completed and refreshed the catalog, it simply
        // declined to prune. Treating it as "no full sync happened" would
        // retry the authoritative run immediately and hit the same guard.
        outcome: { in: [SYNC_OUTCOMES.SUCCESS, SYNC_OUTCOMES.PARTIAL] },
      },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });

    return run?.startedAt ?? null;
  }

  async findMany(query: ListSyncRunsQuery): Promise<Paginated<OfferSyncRun>> {
    const limit = Math.min(Math.max(1, query.limit ?? 25), 100);
    const offset = Math.max(0, query.offset ?? 0);

    const where = {
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.offerSyncRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.offerSyncRun.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  static toSummary(run: OfferSyncRun, providerSlug: string): SyncRunSummary {
    return {
      id: run.id,
      providerId: run.providerId,
      providerSlug,
      mode: run.mode,
      outcome: run.outcome,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs:
        run.finishedAt === null
          ? null
          : run.finishedAt.getTime() - run.startedAt.getTime(),
      offersFetched: run.offersFetched,
      offersAccepted: run.offersAccepted,
      offersRejected: run.offersRejected,
      offersCreated: run.offersCreated,
      offersUpdated: run.offersUpdated,
      offersDeactivated: run.offersDeactivated,
      rejections: (run.rejections ?? {}) as Partial<Record<OfferRejectionReason, number>>,
      errorSummary: run.errorSummary,
    };
  }
}
