import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type AdminClickSummary,
  type ClickResponse,
  type ClickSummary,
  type Paginated,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import { PrismaService } from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { Click, Prisma } from '../../generated/prisma/client';
import { OffersService } from '../offers/offers.service';
import { ProvidersService } from '../providers/providers.service';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import {
  CLICKS_ATTRIBUTION_WINDOW_DAYS,
  CLICKS_MAX_PER_IP_PER_HOUR,
  CLICKS_MAX_PER_USER_PER_HOUR,
} from './clicks.config';
import { SUB_ID_SIGNER } from './clicks.tokens';
import type { SubIdSigner } from './internal/sub-id';

/** Everything captured at click time. Most of it is evidence, not input. */
export interface CreateClickInput {
  userId: string;
  offerId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  referrer?: string | null;
}

const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_TEXT = 512;

/**
 * Owner of the `clicks` table — DATABASE.md §11.
 *
 * A click is the promise made to the user. Everything here is arranged around
 * one rule from PROJECT.md §4.3: **the row is written before the redirect**.
 * A user sent to a provider with no click behind them has done work nobody can
 * credit and support cannot explain, and that is unrecoverable — the provider
 * will report a conversion against a `sub_id` we never issued.
 */
@Injectable()
export class ClicksService {
  private readonly logger = new Logger(ClicksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OffersService,
    private readonly providers: ProvidersService,
    private readonly registry: ProviderRegistry,
    private readonly configuration: ConfigurationService,
    @Inject(SUB_ID_SIGNER) private readonly signer: SubIdSigner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Records a click and returns where to send the user.
   *
   * The ordering is the design:
   *
   *  1. Everything that can refuse, refuses first — offer, provider, limits.
   *  2. The redirect URL is built *before* the insert. It is a pure function
   *     (§7.1) but it can still reject a template with an unsubstituted
   *     placeholder, and discovering that after the write would leave a click
   *     row for a redirect that never happened.
   *  3. The insert is last, and is a single statement. No transaction is
   *     needed because there is exactly one row and no side effect to keep in
   *     step with it — DATABASE.md §10.1 lists no boundary for this operation,
   *     and wrapping one insert would be ceremony.
   */
  async create(input: CreateClickInput): Promise<ClickResponse> {
    const offer = await this.offers.requireById(input.offerId);

    if (!offer.isActive) {
      /*
       * An inactive offer is one the provider withdrew or an admin pulled.
       * Sending a user to it means they do the work and the provider reports
       * nothing, because the campaign is over — the single most common source
       * of "I completed this and was not paid".
       */
      throw new DomainError(
        ERROR_CODES.CLICK_OFFER_UNAVAILABLE,
        'This offer is no longer available',
        409,
        { offerId: offer.id },
      );
    }

    const provider = await this.providers.requireById(offer.providerId);

    /*
     * `require` refuses a disabled provider and one whose adapter could not be
     * registered. Both matter here: a disabled provider is inert by
     * definition (§7.3), and an unregistrable one cannot verify the postback
     * this click is supposed to produce, so the conversion would arrive and be
     * quarantined.
     */
    const registered = this.registry.require(provider.slug);

    await this.assertWithinRateLimits(input.userId, input.ipAddress ?? null);

    const now = this.clock.now();
    const windowDays = await this.configuration.get<number>(
      CLICKS_ATTRIBUTION_WINDOW_DAYS.key,
      provider.id,
    );

    const subId = this.signer.issue();

    const redirectUrl = registered.adapter.buildClickUrl({
      trackingUrlTemplate: offer.trackingUrlTemplate,
      externalOfferId: offer.externalId,
      // Opaque and stable. The raw user id never reaches a provider.
      userReference: this.signer.userReference(input.userId),
      subId,
    });

    const click = await this.prisma.click.create({
      data: {
        id: uuidv7(),
        userId: input.userId,
        offerId: offer.id,
        providerId: provider.id,
        subId,

        // Frozen here, because the offer row is overwritten by every sync.
        offerTitleSnapshot: offer.title,
        rewardPointsSnapshot: offer.rewardPoints,

        ipAddress: input.ipAddress ?? null,
        userAgent: truncate(input.userAgent),
        deviceFingerprint: truncate(input.deviceFingerprint),
        referrer: truncate(input.referrer),

        attributionExpiresAt: new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000),
        createdAt: now,
      },
    });

    this.logger.log(
      {
        clickId: click.id,
        userId: input.userId,
        offerId: offer.id,
        providerSlug: provider.slug,
        rewardPoints: offer.rewardPoints,
      },
      'Click recorded',
    );

    return {
      id: click.id,
      subId: click.subId,
      redirectUrl,
      offerId: click.offerId,
      providerSlug: provider.slug,
      offerTitle: click.offerTitleSnapshot,
      rewardPoints: click.rewardPointsSnapshot,
      attributionExpiresAt: click.attributionExpiresAt.toISOString(),
      createdAt: click.createdAt.toISOString(),
    };
  }

  /**
   * Resolves a `sub_id` arriving from a provider.
   *
   * The signature is checked **before** the database is touched. A forged
   * identifier is then rejected in microseconds, and the public postback
   * surface cannot be used to drive query load by anyone who can type.
   *
   * Distinguishes three outcomes on purpose — never ours, ours but unknown,
   * ours but expired — because §10.2 gives each a different postback response
   * and a different operator action.
   */
  async resolveSubId(subId: string): Promise<Click> {
    if (!this.signer.verify(subId)) {
      throw new DomainError(
        ERROR_CODES.CLICK_SUB_ID_INVALID,
        'This sub_id was not issued by us',
        400,
        { subId },
      );
    }

    const click = await this.prisma.click.findUnique({ where: { subId } });

    if (!click) {
      throw new DomainError(ERROR_CODES.CLICK_NOT_FOUND, 'No click for this sub_id', 404, {
        subId,
      });
    }

    if (this.isExpired(click)) {
      throw new DomainError(
        ERROR_CODES.CLICK_ATTRIBUTION_EXPIRED,
        'The attribution window for this click has closed',
        409,
        { subId, expiredAt: click.attributionExpiresAt.toISOString() },
      );
    }

    return click;
  }

  /** Unverified lookup, for surfaces that already know the id is ours. */
  async findBySubId(subId: string): Promise<Click | null> {
    return this.prisma.click.findUnique({ where: { subId } });
  }

  /**
   * Derived from the stored expiry, never re-resolved from configuration.
   *
   * That is the whole point of storing the window: an admin shortening it
   * cannot retroactively close a window a user was already promised.
   */
  isExpired(click: Click, at: Date = this.clock.now()): boolean {
    return click.attributionExpiresAt.getTime() <= at.getTime();
  }

  // --- Reads --------------------------------------------------------------

  async findManyForUser(
    userId: string,
    query: { offerId?: string; providerId?: string; limit?: number; offset?: number },
  ): Promise<Paginated<Click>> {
    return this.findMany({ ...query, userId });
  }

  async findMany(query: {
    userId?: string;
    offerId?: string;
    providerId?: string;
    subId?: string;
    ipAddress?: string;
    limit?: number;
    offset?: number;
  }): Promise<Paginated<Click>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.ClickWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.subId ? { subId: query.subId } : {}),
      ...(query.ipAddress ? { ipAddress: query.ipAddress } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.click.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.click.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * How many *other* accounts have been seen from this IP since `since`.
   *
   * Part of the multi-accounting signal PROJECT.md §4.7 asks for, exposed here
   * rather than computed by `fraud`, because `clicks` owns the table
   * (DATABASE.md §11.2) and `fraud` imports no business module (§4.2). The
   * caller assembles this into the evaluation context.
   *
   * **Excludes the user being scored**, so the number reads as "how many
   * strangers share this address" rather than always being at least one.
   */
  async countOtherAccountsSharingIp(
    ipAddress: string,
    excludeUserId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.prisma.click.findMany({
      where: { ipAddress, createdAt: { gte: since }, userId: { not: excludeUserId } },
      distinct: ['userId'],
      select: { userId: true },
      take: SHARED_IDENTITY_SCAN_LIMIT,
    });

    return rows.length;
  }

  /**
   * The same question for a device fingerprint.
   *
   * The fingerprint is client-supplied and therefore forgeable (§3.3), which
   * is why this feeds a score rather than a decision — a forged one produces a
   * hold an admin can clear, and a rule that blocked on it would hand every
   * attacker a way to get other people's accounts held.
   */
  async countOtherAccountsSharingDevice(
    deviceFingerprint: string,
    excludeUserId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.prisma.click.findMany({
      where: {
        deviceFingerprint,
        createdAt: { gte: since },
        userId: { not: excludeUserId },
      },
      distinct: ['userId'],
      select: { userId: true },
      take: SHARED_IDENTITY_SCAN_LIMIT,
    });

    return rows.length;
  }

  /**
   * Click ids seen from this IP since `since`.
   *
   * The per-IP conversion velocity rule counts *conversions*, which `clicks`
   * does not own. Handing back ids lets `conversions` count its own rows
   * without either module reaching into the other's table (§11.2).
   */
  async findIdsByIpSince(ipAddress: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.click.findMany({
      where: { ipAddress, createdAt: { gte: since } },
      select: { id: true },
      take: IP_VELOCITY_SCAN_LIMIT,
    });

    return rows.map((row) => row.id);
  }

  async requireById(id: string): Promise<Click> {
    const click = await this.prisma.click.findUnique({ where: { id } });
    if (!click) {
      throw new DomainError(ERROR_CODES.CLICK_NOT_FOUND, 'Click not found', 404, { id });
    }
    return click;
  }

  // --- Serialisation ------------------------------------------------------

  /**
   * The owner's view — §19.3, an allowlist.
   *
   * Deliberately excludes the IP, the user agent and the device fingerprint.
   * They were captured *about* this user for fraud purposes; echoing them back
   * confirms to anyone who has taken the account exactly what signals we hold.
   */
  toSummary(click: Click, providerSlug: string): ClickSummary {
    return {
      id: click.id,
      subId: click.subId,
      offerId: click.offerId,
      providerSlug,
      offerTitle: click.offerTitleSnapshot,
      rewardPoints: click.rewardPointsSnapshot,
      attributionExpiresAt: click.attributionExpiresAt.toISOString(),
      isExpired: this.isExpired(click),
      createdAt: click.createdAt.toISOString(),
    };
  }

  /** The investigator's view: everything above, plus the evidence. */
  toAdminSummary(click: Click, providerSlug: string): AdminClickSummary {
    return {
      ...this.toSummary(click, providerSlug),
      userId: click.userId,
      providerId: click.providerId,
      ipAddress: click.ipAddress,
      userAgent: click.userAgent,
      deviceFingerprint: click.deviceFingerprint,
      referrer: click.referrer,
    };
  }

  // --- Internals ----------------------------------------------------------

  /**
   * The click limit — ARCHITECTURE.md §19.5's third layer.
   *
   * Counted from the `clicks` table rather than from Redis counters. §14.1
   * puts velocity counters in Redis, and that is the right home for them when
   * `fraud` needs cross-module velocity at conversion time; for this one
   * check, on a table this module owns, an indexed count over a one-hour
   * window is exact, has no invalidation problem, and needs no second store
   * that can disagree with the rows (P6). The index exists precisely for it.
   *
   * Checked *before* the insert and outside any transaction, so two clicks
   * arriving in the same millisecond can both pass. That is accepted
   * deliberately: this is a fraud control bounding sustained behaviour, not an
   * accounting invariant, and the cost of a race is one extra click. Making it
   * exact would mean serialising every click behind a lock on the user row —
   * real contention, on the hot path, to prevent an off-by-one in a threshold
   * that is itself a judgement call.
   */
  private async assertWithinRateLimits(
    userId: string,
    ipAddress: string | null,
  ): Promise<void> {
    const since = new Date(this.clock.nowMs() - RATE_WINDOW_MS);

    const [perUserLimit, perIpLimit] = await Promise.all([
      this.configuration.get<number>(CLICKS_MAX_PER_USER_PER_HOUR.key),
      this.configuration.get<number>(CLICKS_MAX_PER_IP_PER_HOUR.key),
    ]);

    const userClicks = await this.prisma.click.count({
      where: { userId, createdAt: { gte: since } },
    });

    if (userClicks >= perUserLimit) {
      this.logger.warn(
        { userId, count: userClicks, limit: perUserLimit },
        'Click rate limit exceeded for user',
      );
      throw rateLimited('user');
    }

    // Skipped when the address is unknown rather than counted as a shared
    // bucket: grouping every unidentified caller together would let one of
    // them exhaust the limit for all of them.
    if (ipAddress === null) return;

    const ipClicks = await this.prisma.click.count({
      where: { ipAddress, createdAt: { gte: since } },
    });

    if (ipClicks >= perIpLimit) {
      this.logger.warn(
        { ipAddress, count: ipClicks, limit: perIpLimit },
        'Click rate limit exceeded for IP',
      );
      throw rateLimited('ip');
    }
  }
}

/**
 * 429, with the same code for both limits.
 *
 * The scope is logged, not returned. Telling a caller *which* ceiling they hit
 * tells them how to spread their clicks to stay under it, which is precisely
 * what the control exists to prevent.
 */
function rateLimited(scope: 'user' | 'ip'): DomainError {
  return new DomainError(
    ERROR_CODES.CLICK_RATE_LIMIT_EXCEEDED,
    'Too many clicks. Please wait before trying again.',
    429,
    { scope },
  );
}

function truncate(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_TEXT);
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Ceilings on the fraud read surface.
 *
 * The signal is "more accounts than the threshold", and every configured
 * threshold is far below these. Counting the exact size of a botnet costs a
 * scan proportional to the botnet and changes no decision — the rule has
 * already fired.
 */
const SHARED_IDENTITY_SCAN_LIMIT = 200;
const IP_VELOCITY_SCAN_LIMIT = 1000;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

export const __testing = { clampLimit, truncate, RATE_WINDOW_MS, MAX_TEXT };
