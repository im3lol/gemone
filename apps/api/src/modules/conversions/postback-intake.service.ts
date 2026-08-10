import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  POSTBACK_STATES,
  type AdminListPostbacksQuery,
  type AdminPostbackDetail,
  type AdminPostbackSummary,
  type Paginated,
  type PostbackAcknowledgement,
  type QuarantineReason,
} from '@gemone/contracts';
import { Queue } from 'bullmq';
import { v7 as uuidv7 } from 'uuid';

import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import {
  POSTBACK_JOBS,
  QUEUES,
  type PostbackProcessJobData,
} from '../../core/queue/queue.constants';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { Prisma, Provider, ProviderPostback } from '../../generated/prisma/client';
import type { RawPostbackRequest } from '../providers/contracts/normalized';
import { ProvidersService } from '../providers/providers.service';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import {
  captureHeaders,
  capturePayload,
  summarizeFailure,
} from './internal/request-capture';

/** One inbound request, as the controller hands it over. */
export interface PostbackEnvelope {
  providerSlug: string;
  method: string;
  query: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
  rawBody?: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Already resolved through the trusted proxy. Null when it cannot be determined. */
  sourceIp: string | null;
}

/**
 * The postback intake surface — ARCHITECTURE.md §10.1.
 *
 * Owner of `provider_postbacks` (DATABASE.md §11), and the highest-risk
 * surface in the system. Everything here is arranged around one sentence from
 * §10.1: **fast and dumb**. No business logic, no balance access, no provider
 * callbacks. The handler validates, persists what arrived, and acknowledges.
 *
 * The order of the checks is the design, and it is defence in depth (§19.2) —
 * each layer assumes the previous one failed:
 *
 *  1. **Provider** — unknown or disabled providers are refused before
 *     anything else runs. A disabled provider is inert (§7.3), and that has
 *     to include its public endpoint or "disabling" would not stop the thing
 *     an operator disabled it to stop.
 *  2. **Source IP** — the cheapest check, against ranges an operator controls
 *     without a deploy.
 *  3. **Signature** — the adapter's, over the bytes as they arrived.
 *  4. **Parsing** — strict, and only now, on input we know is authentic.
 *  5. **The unique constraint** — the guarantee, in the database, where a
 *     concurrent retry cannot race past it.
 *
 * Nothing is archived before step 3 passes. The endpoint is public and
 * unauthenticated by necessity, so a row written for unverified input is a
 * table anyone who can type is allowed to fill.
 */
@Injectable()
export class PostbackIntakeService {
  private readonly logger = new Logger(PostbackIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly registry: ProviderRegistry,
    @InjectQueue(QUEUES.POSTBACKS) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async receive(envelope: PostbackEnvelope): Promise<PostbackAcknowledgement> {
    const provider = await this.providers.findBySlug(envelope.providerSlug);

    if (!provider) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_NOT_FOUND,
        'Unknown postback endpoint',
        404,
        { slug: envelope.providerSlug },
      );
    }

    /*
     * Refuses a disabled provider and one whose adapter could not be brought
     * up. The statuses come from the registry unchanged — 409 rather than a
     * bespoke 403 — because §10.2's governing principle is about *retry*
     * behaviour, and every 4xx is equally non-retryable. One mapping beats
     * two that can disagree (P6).
     */
    const registered = this.registry.require(provider.slug);

    this.assertSourceAllowed(provider, envelope.sourceIp);

    const raw: RawPostbackRequest = {
      query: envelope.query,
      body: envelope.body,
      headers: envelope.headers,
      // The adapter contract says "already resolved through the trusted
      // proxy"; an unknown address is passed as empty rather than as a
      // plausible-looking placeholder an adapter might match on.
      sourceIp: envelope.sourceIp ?? '',
      ...(envelope.rawBody === undefined ? {} : { rawBody: envelope.rawBody }),
    };

    const verification = registered.adapter.verifyPostback(raw);

    if (!verification.valid) {
      /*
       * `warn`, not `error`. A forged postback on a public endpoint is an
       * expected event, and logging it as a fault trains everyone to ignore
       * the error log. The reason is included and returned: the caller either
       * holds the secret — in which case it is the fastest possible answer to
       * "why is our integration failing" — or does not, in which case
       * "signature mismatch" tells them nothing they could not already infer
       * from the 401.
       */
      this.logger.warn(
        {
          providerSlug: provider.slug,
          sourceIp: envelope.sourceIp,
          reason: verification.reason,
        },
        'Postback rejected: signature verification failed',
      );

      throw new DomainError(
        ERROR_CODES.POSTBACK_SIGNATURE_INVALID,
        `Signature verification failed: ${verification.reason}`,
        401,
        { slug: provider.slug },
      );
    }

    const payload = capturePayload(envelope);
    const headers = captureHeaders(envelope.headers);

    let conversion;
    try {
      conversion = registered.adapter.parsePostback(raw);
    } catch (error) {
      return this.archiveUnparseable(provider.id, provider.slug, {
        payload,
        headers,
        sourceIp: envelope.sourceIp,
        error,
      });
    }

    return this.archive(provider.id, provider.slug, {
      externalTransactionId: conversion.externalTransactionId,
      payload,
      headers,
      sourceIp: envelope.sourceIp,
    });
  }

  // --- Intake steps ---------------------------------------------------------

  /**
   * The IP allowlist — §10.1, step 3.
   *
   * The *decision* belongs to `providers`: the ranges are on the row it owns,
   * and what an empty list means is a property of that column (§5, rules 3
   * and 4). What belongs here is the consequence — a 403 that is visible in
   * the provider's own dashboard, because the usual cause is a network that
   * changed its egress addresses without telling anyone.
   */
  private assertSourceAllowed(provider: Provider, sourceIp: string | null): void {
    if (this.providers.isPostbackSourceAllowed(provider, sourceIp)) return;

    this.logger.warn(
      { providerSlug: provider.slug, sourceIp, ranges: provider.postbackIpRanges },
      'Postback rejected: source address is outside the configured ranges',
    );

    throw new DomainError(
      ERROR_CODES.POSTBACK_SOURCE_NOT_ALLOWED,
      'Source address is not permitted for this provider',
      403,
      { slug: provider.slug, sourceIp },
    );
  }

  /**
   * Archives a verified, parsed postback and enqueues its processing.
   *
   * The insert is attempted, not preceded by a lookup. A check-then-insert is
   * the race this constraint exists to prevent: two concurrent retries both
   * look, both find nothing, and both insert. The database is the only place
   * where the answer cannot depend on how the requests interleave (§10.1).
   */
  private async archive(
    providerId: string,
    providerSlug: string,
    input: {
      externalTransactionId: string;
      payload: unknown;
      headers: Record<string, string>;
      sourceIp: string | null;
    },
  ): Promise<PostbackAcknowledgement> {
    const now = this.clock.now();

    let stored: ProviderPostback;

    try {
      stored = await this.prisma.providerPostback.create({
        data: {
          id: uuidv7(),
          providerId,
          externalTransactionId: input.externalTransactionId,
          payload: input.payload as Prisma.InputJsonValue,
          headers: input.headers,
          sourceIp: input.sourceIp,
          state: POSTBACK_STATES.RECEIVED,
          receivedAt: now,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      await this.markDuplicate(providerId, input.externalTransactionId, now);

      this.logger.log(
        { providerSlug, externalTransactionId: input.externalTransactionId },
        'Duplicate postback acknowledged',
      );

      // 200, not a 4xx (§10.2). It was already accepted; an error here makes
      // some providers retry harder and others open a support ticket.
      return { status: 'duplicate' };
    }

    await this.enqueueProcessing(stored.id, providerSlug);

    this.logger.log(
      {
        postbackId: stored.id,
        providerSlug,
        externalTransactionId: input.externalTransactionId,
      },
      'Postback received',
    );

    return { status: 'accepted' };
  }

  /**
   * Archives a postback that verified and would not parse.
   *
   * **Deliberately still archived.** §10.1's flow parses before it inserts,
   * which reads as "drop it" — but the same section's stated reason for
   * storing raw payloads is that processing can have a bug, and parsing is
   * processing. A provider changing a field name would otherwise mean every
   * conversion during the incident is lost with no evidence it ever arrived,
   * and those are conversions users completed.
   *
   * Safe to archive because it is past the signature check: only someone
   * holding the provider's secret can write these rows.
   *
   * Not enqueued — there is nothing to process — and not deduplicated, since
   * an unparseable payload has no transaction id to deduplicate on.
   */
  private async archiveUnparseable(
    providerId: string,
    providerSlug: string,
    input: {
      payload: unknown;
      headers: Record<string, string>;
      sourceIp: string | null;
      error: unknown;
    },
  ): Promise<never> {
    const detail = summarizeFailure(input.error);

    const stored = await this.prisma.providerPostback.create({
      data: {
        id: uuidv7(),
        providerId,
        externalTransactionId: null,
        payload: input.payload as Prisma.InputJsonValue,
        headers: input.headers,
        sourceIp: input.sourceIp,
        state: POSTBACK_STATES.REJECTED,
        errorDetail: detail,
        receivedAt: this.clock.now(),
      },
    });

    /*
     * `error`, unlike the signature and allowlist rejections. Those are
     * hostile input behaving as expected; this is an authenticated provider
     * sending something we cannot read, which is either their format drifting
     * or our adapter being wrong. Both are somebody's action item.
     */
    this.logger.error(
      { postbackId: stored.id, providerSlug, reason: detail },
      'Postback verified but could not be parsed',
    );

    throw new DomainError(
      ERROR_CODES.POSTBACK_PAYLOAD_INVALID,
      'Postback payload could not be parsed',
      400,
      { slug: providerSlug, postbackId: stored.id },
    );
  }

  /**
   * §10.1's "mark duplicate", on the row being duplicated.
   *
   * The count is the only visibility anyone has into a provider retry storm:
   * a number climbing while nothing else changes says our acknowledgement is
   * not reaching them.
   */
  private async markDuplicate(
    providerId: string,
    externalTransactionId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.providerPostback.update({
      where: {
        providerId_externalTransactionId: { providerId, externalTransactionId },
      },
      data: { duplicateCount: { increment: 1 }, lastDuplicateAt: at },
    });
  }

  /**
   * Enqueues processing **after** the row is committed (§10.1, step 7).
   *
   * Ordering matters in one direction only: a job that ran before the commit
   * would look up a row that is not there yet.
   *
   * A failure to enqueue does **not** fail the request. The row is already
   * durable, and returning 500 would make the provider retry — which we would
   * then correctly recognise as a duplicate and still not enqueue, so the
   * retry buys nothing and costs a duplicate. `provider_postbacks` is the
   * replay source (§10.1); a `RECEIVED` row with no job is exactly what a
   * replay finds and re-dispatches.
   */
  private async enqueueProcessing(postbackId: string, providerSlug: string): Promise<void> {
    const data: PostbackProcessJobData = { postbackId };

    try {
      await this.queue.add(POSTBACK_JOBS.PROCESS, data, {
        /*
         * The row id is the natural key (§13.2), so a re-dispatch of the same
         * postback is a no-op rather than a second credit attempt.
         *
         * Contains no `:` — BullMQ composes its Redis keys as
         * `bull:<queue>:<id>` and rejects a custom id containing a colon,
         * which throws here rather than producing a duplicate. A UUID has
         * none; this is stated because the catalog queue learned it the hard
         * way.
         */
        jobId: `${POSTBACK_JOBS.PROCESS}_${postbackId}`,
      });
    } catch (error) {
      this.logger.error(
        { postbackId, providerSlug, err: summarizeFailure(error) },
        'Postback archived but could not be enqueued — it will need a replay',
      );
    }
  }

  // --- Lifecycle, driven by processing --------------------------------------

  /*
   * The archive's state transitions live here, with the only writer of the
   * table, rather than in `ConversionsService`.
   *
   * Both services belong to the `conversions` module, so either *could* write
   * these rows without crossing a boundary (§5, rule 4). One writer is still
   * better: "which states can a postback be in, and who moves it between them"
   * is answerable by reading one file, and it stays that way when the retry
   * and replay paths arrive.
   *
   * Every one of these takes an optional transaction client, because marking a
   * postback processed belongs in the *same* transaction as the conversion it
   * produced (DATABASE.md §10.1) — partial completion there is a missing or
   * duplicated credit.
   */

  /** Terminal success: this postback became the conversion it was meant to. */
  async markProcessed(
    id: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await client.providerPostback.update({
      where: { id },
      data: {
        state: POSTBACK_STATES.PROCESSED,
        processingAttempts: { increment: 1 },
        errorDetail: null,
      },
    });
  }

  /**
   * Needs a human — PROJECT.md §4.4.
   *
   * Unmatched postbacks are quarantined for admin review, **never silently
   * dropped**. A silent drop is a user who completed an offer, was never paid,
   * and about whom no record exists to argue with.
   *
   * Not retried: nothing about waiting makes an unknown `sub_id` known, and an
   * expired attribution window does not reopen.
   */
  async markQuarantined(
    id: string,
    reason: QuarantineReason,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await client.providerPostback.update({
      where: { id },
      data: {
        state: POSTBACK_STATES.QUARANTINED,
        processingAttempts: { increment: 1 },
        errorDetail: reason,
      },
    });
  }

  /**
   * Processing broke for a reason a retry might fix.
   *
   * Distinct from quarantine on purpose: this is *our* failure, so the row
   * stays in a state a replay picks up, while a quarantine is a decision that
   * needs somebody. Collapsing them would either retry things that can never
   * succeed or strand things that would have.
   */
  async markFailed(
    id: string,
    detail: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await client.providerPostback.update({
      where: { id },
      data: {
        state: POSTBACK_STATES.FAILED,
        processingAttempts: { increment: 1 },
        errorDetail: detail.slice(0, 500),
      },
    });
  }

  // --- Reads ----------------------------------------------------------------

  async findMany(query: AdminListPostbacksQuery): Promise<Paginated<ProviderPostback>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.ProviderPostbackWhereInput = {
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(query.externalTransactionId
        ? { externalTransactionId: query.externalTransactionId }
        : {}),
      ...(query.sourceIp ? { sourceIp: query.sourceIp } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.providerPostback.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.providerPostback.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async requireById(id: string): Promise<ProviderPostback> {
    const postback = await this.prisma.providerPostback.findUnique({ where: { id } });

    if (!postback) {
      throw new DomainError(ERROR_CODES.POSTBACK_NOT_FOUND, 'Postback not found', 404, {
        id,
      });
    }

    return postback;
  }

  // --- Serialisation --------------------------------------------------------

  /** The list view — an allowlist (§19.3), without the payload. */
  toSummary(postback: ProviderPostback, providerSlug: string): AdminPostbackSummary {
    return {
      id: postback.id,
      providerId: postback.providerId,
      providerSlug,
      externalTransactionId: postback.externalTransactionId,
      state: postback.state,
      sourceIp: postback.sourceIp,
      duplicateCount: postback.duplicateCount,
      lastDuplicateAt: postback.lastDuplicateAt?.toISOString() ?? null,
      processingAttempts: postback.processingAttempts,
      errorDetail: postback.errorDetail,
      receivedAt: postback.receivedAt.toISOString(),
    };
  }

  /** The detail view: the same record plus the verbatim evidence. */
  toDetail(postback: ProviderPostback, providerSlug: string): AdminPostbackDetail {
    return {
      ...this.toSummary(postback, providerSlug),
      payload: postback.payload,
      headers: (postback.headers ?? {}) as Record<string, string>,
    };
  }
}

/**
 * Recognises Postgres 23505 as surfaced by Prisma's P2002.
 *
 * Kept narrow on purpose: a broad `catch` that assumed every failure was a
 * duplicate would return 200 to a provider while the database was down, and
 * a postback acknowledged but never stored is a conversion nobody can pay.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'P2002';
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

export const __testing = { isUniqueViolation, clampLimit, DEFAULT_LIMIT, MAX_LIMIT };
