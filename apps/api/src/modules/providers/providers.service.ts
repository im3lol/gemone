import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateProviderRequest,
  type ListProvidersQuery,
  type ProviderSummary,
  type UpdateProviderRequest,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError, ValidationError } from '../../core/errors/app-error';
import { InvalidationBus } from '../../core/events/invalidation.bus';
import { INVALIDATION_DOMAINS } from '../../core/events/invalidation-message';
import type { Prisma, Provider } from '../../generated/prisma/client';
import { ipMatchesAnyRange, isValidIpRange, isValidProviderSlug } from './internal/ip-range';
import { PROVIDER_CONFIGURATION_KEYS } from './providers.config';
import { ProviderRegistry } from './registry/provider-registry';

/** Bounds on the sync cadence. Below the floor we hammer a provider's API; above the ceiling the catalog is stale enough to show offers that no longer exist. */
const MIN_SYNC_INTERVAL_MINUTES = 5;
const MAX_SYNC_INTERVAL_MINUTES = 24 * 60;
const MAX_IP_RANGES = 64;

/**
 * Owner of the `providers` table — DATABASE.md §11.
 *
 * Two jobs, and they are deliberately in one service because they are the
 * same lifecycle seen from two sides: it is the only writer of provider rows,
 * and it is what feeds those rows to the registry.
 *
 * It holds the *rules* about providers; `admin` composes them and records the
 * audit entry (§4.3). The split matters because the common failure is an
 * admin panel that grows a parallel implementation of the same rules, which
 * then drifts — and the admin path is the one that is wrong.
 */
@Injectable()
export class ProvidersService implements OnApplicationBootstrap, OnModuleInit {
  private readonly logger = new Logger(ProvidersService.name);

  /**
   * Serialises reloads — the guard TODO T14 asked for, whose trigger was
   * "the Redis pub/sub invalidation in T3".
   *
   * `reload()` reads every provider row and swaps the result in wholesale. Two
   * reloads running at once can therefore finish in the opposite order to the
   * one they started in, leaving the registry describing an *older* database
   * state than a reload that already completed — and the snapshot stays wrong
   * until something else reloads.
   *
   * That was self-healing while reloads only followed local writes: the
   * scheduled catalog tick re-reads before every decision, so the window closed
   * at the next tick. §14.3 removes the "only": a remote invalidation can now
   * arrive in the middle of a local reload, at a moment nothing chose. Chaining
   * makes overlap impossible, which is a stronger guarantee than a version
   * check and needs no version to carry — and reloads happen a few times a
   * week, so the serialisation costs nothing anybody can measure.
   */
  private reloadChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly configuration: ConfigurationService,
    private readonly invalidations: InvalidationBus,
  ) {}

  /**
   * Listens for provider changes made by other processes — §14.3, TODO T3.
   *
   * In `onModuleInit` rather than beside the boot reload below, because every
   * module's `onModuleInit` runs before any `onApplicationBootstrap`: the
   * handler has to be registered before the bus subscribes to Redis, or the
   * first message after boot lands with nothing to receive it.
   *
   * The registry is one snapshot rather than a map of independently
   * invalidatable rows, so there is nothing finer to say than "reload" — the
   * entry is ignored, and `reload()` is deliberately the *local* half, so a
   * message received here cannot cause another to be sent.
   */
  onModuleInit(): void {
    this.invalidations.subscribe(INVALIDATION_DOMAINS.PROVIDERS, () => this.reload());
  }

  /**
   * `onApplicationBootstrap`, not `onModuleInit`.
   *
   * The distinction is load-bearing: `onModuleInit` fires per module as the
   * graph initialises, and this needs a *connected* database. Bootstrap runs
   * after every module has initialised, so `PrismaService.$connect` has
   * already completed. With `onModuleInit` the ordering happens to work
   * today and would break the first time the module graph is rearranged —
   * as a registry that is silently empty, which reads as "every provider was
   * disabled".
   */
  async onApplicationBootstrap(): Promise<void> {
    // Keys are registered by the module that owns the rule (§4.9), at
    // startup, so a value can never be written for a key nothing reads.
    for (const definition of PROVIDER_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }

    await this.reload();
  }

  /**
   * Reads every provider row and rebuilds the registry snapshot **on this
   * process only**.
   *
   * Deliberately reloads *all* rows rather than patching the one that changed:
   * a full rebuild has no partial states to get wrong, and it runs on an
   * operator action a few times a week, not on a request path.
   *
   * This is the local half. Three kinds of caller want exactly it and nothing
   * more — the boot sequence, the §14.3 subscriber, and the two read-repair
   * paths that reload on a registry miss (D35) — because none of them is a
   * change anybody else needs to hear about. A caller that has just *written* a
   * provider row wants `reloadAndBroadcast`.
   */
  async reload(): Promise<void> {
    const next = this.reloadChain.then(
      () => this.rebuild(),
      // Runs even if the previous reload rejected: one failure must not stop
      // the chain, or a single transient database error would leave the
      // registry frozen for the life of the process.
      () => this.rebuild(),
    );

    this.reloadChain = next.catch(() => undefined);

    return next;
  }

  /**
   * Rebuilds here and tells every other process to rebuild theirs — §14.3.
   *
   * **After the commit, never inside the transaction** — the same ordering
   * D51 established for configuration, for a reason that grows with the number
   * of processes: a broadcast sent before the commit invites every other
   * process to read the table and cache what is still the old state.
   *
   * The broadcast cannot fail the caller. This process's registry is correct
   * either way, and a notification that did not go out is a degradation
   * (§14.4) — it leaves the others where they were before this feature, which
   * is stale until their next read-repair or restart.
   */
  async reloadAndBroadcast(): Promise<void> {
    await this.reload();
    await this.invalidations.publish(INVALIDATION_DOMAINS.PROVIDERS, null);
  }

  private async rebuild(): Promise<void> {
    const rows = await this.prisma.provider.findMany({ orderBy: { slug: 'asc' } });

    this.registry.load(
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        isEnabled: row.isEnabled,
      })),
    );
  }

  // --- Reads --------------------------------------------------------------

  async findAll(query: ListProvidersQuery = {}): Promise<Provider[]> {
    const where: Prisma.ProviderWhereInput = {
      ...(query.isEnabled === undefined ? {} : { isEnabled: query.isEnabled }),
      ...(query.healthState ? { healthState: query.healthState } : {}),
    };

    return this.prisma.provider.findMany({ where, orderBy: { slug: 'asc' } });
  }

  async findById(id: string): Promise<Provider | null> {
    return this.prisma.provider.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Provider | null> {
    return this.prisma.provider.findUnique({ where: { slug } });
  }

  async requireById(id: string): Promise<Provider> {
    const provider = await this.findById(id);
    if (!provider) throw providerNotFound(id);
    return provider;
  }

  /**
   * Is this address permitted to send postbacks for this provider?
   *
   * Exposed here rather than as a helper the postback surface calls directly,
   * because both halves of the answer are this module's knowledge: the ranges
   * live on the row it owns, and what an *empty* list means is a property of
   * that column, not of whoever is asking. §5 rule 3 is the same rule — a
   * module reaching into `providers/internal/` would be reimplementing this
   * decision at the call site, which is where it would later drift.
   *
   * **Empty means "do not check the source"** (see the column comment). It is
   * honoured rather than second-guessed: an operator who has not filled it in
   * yet gets a provider that works and a signature check, not one that
   * silently rejects everything a real network sends.
   *
   * With ranges configured, an address we could not determine is refused. The
   * alternative — allowing what cannot be checked — turns a misconfigured
   * `trust proxy` into a silently disabled allowlist.
   */
  isPostbackSourceAllowed(provider: Provider, sourceIp: string | null): boolean {
    if (provider.postbackIpRanges.length === 0) return true;
    if (sourceIp === null) return false;

    return ipMatchesAnyRange(sourceIp, provider.postbackIpRanges);
  }

  // --- Writes -------------------------------------------------------------

  /**
   * Registers a provider row for an adapter this build implements.
   *
   * Created **disabled**, always, and the request cannot say otherwise. A
   * provider needs its postback ranges and its per-provider configuration set
   * before it should receive anything, and a create call that could enable in
   * the same step invites doing it in the wrong order. Enabling is a separate,
   * audited decision.
   *
   * Takes an optional transaction client, like every write here, so the
   * caller can record its audit entry in the same transaction. None of these
   * methods reloads the registry: a reload inside a transaction that later
   * rolls back would leave the in-memory snapshot disagreeing with the
   * database until the next restart. The caller reloads after it commits.
   */
  async create(
    input: CreateProviderRequest,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Provider> {
    const slug = input.slug.trim().toLowerCase();

    if (!isValidProviderSlug(slug)) {
      throw new ValidationError('Invalid provider slug', [
        {
          field: 'slug',
          message: 'must be 2-32 lowercase alphanumerics separated by single hyphens',
        },
      ]);
    }

    /*
     * The check that keeps §7.3's promise honest at the only moment it can be
     * kept cheaply.
     *
     * A row naming a slug with no adapter is unusable — it can never sync and
     * can never verify a postback. Rejecting it here turns a silent, permanent
     * misconfiguration into an immediate error message with the valid options
     * in it. At runtime the same condition means the code was removed
     * underneath an existing row, and the registry handles that by making the
     * provider inert rather than by refusing to boot.
     */
    if (!this.registry.hasAdapterFor(slug)) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_UNKNOWN_SLUG,
        `No adapter is registered for "${slug}". Available: ${this.registry.knownSlugs().join(', ') || 'none'}`,
        422,
        { slug, known: this.registry.knownSlugs() },
      );
    }

    const ranges = normalizeIpRanges(input.postbackIpRanges);
    const interval = validateSyncInterval(input.syncIntervalMinutes);
    const displayName = requireDisplayName(input.displayName);

    // The unique constraint is the actual guard; this check exists to return
    // a useful error rather than to prevent the race.
    const existing = await client.provider.findUnique({ where: { slug } });
    if (existing) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_SLUG_TAKEN,
        `A provider with slug "${slug}" already exists`,
        409,
        { slug },
      );
    }

    const created = await client.provider.create({
      data: {
        id: uuidv7(),
        slug,
        displayName,
        isEnabled: false,
        postbackIpRanges: ranges,
        ...(interval === undefined ? {} : { syncIntervalMinutes: interval }),
      },
    });

    this.logger.log({ slug, providerId: created.id }, 'Provider created');

    return created;
  }

  /**
   * Updates the operational fields of a provider.
   *
   * Slug is not among them. It is the registry's lookup key, the scope id of
   * every provider-scoped configuration value, and it appears in stored click
   * URLs — renaming it would orphan all three at once, silently.
   */
  async update(
    id: string,
    changes: UpdateProviderRequest,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Provider> {
    const current = await client.provider.findUnique({ where: { id } });
    if (!current) throw providerNotFound(id);

    const data: Prisma.ProviderUpdateInput = {};

    if (changes.displayName !== undefined) {
      data.displayName = requireDisplayName(changes.displayName);
    }
    if (changes.syncIntervalMinutes !== undefined) {
      data.syncIntervalMinutes = validateSyncInterval(changes.syncIntervalMinutes);
    }
    if (changes.postbackIpRanges !== undefined) {
      data.postbackIpRanges = normalizeIpRanges(changes.postbackIpRanges);
    }

    if (Object.keys(data).length === 0) {
      // A no-op write would bump `updated_at` and make the audit trail read
      // as though something changed.
      return current;
    }

    return client.provider.update({ where: { id }, data });
  }

  /**
   * The switch — §7.3.
   *
   * Takes an optional transaction client so the caller can write its audit
   * entry in the same transaction (DATABASE.md §10.1). Disabling a provider
   * without a durable record of who did it and why is the change people ask
   * about first.
   *
   * The registry reload happens *after* the caller's transaction commits, not
   * inside this method, because a reload inside a transaction that later
   * rolls back would leave the in-memory snapshot disagreeing with the
   * database until the next restart.
   */
  async setEnabled(
    id: string,
    enabled: boolean,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Provider> {
    const provider = await client.provider.findUnique({ where: { id } });
    if (!provider) throw providerNotFound(id);

    if (provider.isEnabled === enabled) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_INVALID_CONFIGURATION,
        `Provider "${provider.slug}" is already ${enabled ? 'enabled' : 'disabled'}`,
        409,
        { slug: provider.slug },
      );
    }

    if (enabled) {
      /*
       * Enabling is the moment a provider can start receiving public
       * postbacks and appearing on the wall, so it is the right place to
       * refuse a row the running build cannot actually serve.
       *
       * Checked against the registry's *load result*, not just the map: an
       * adapter can exist and still be unregistrable because a credential is
       * missing from this deployment, and enabling in that state produces a
       * provider that is on, visible, and incapable of verifying anything.
       */
      const failure = this.registry.failures().find((f) => f.slug === provider.slug);
      if (failure) {
        throw new DomainError(
          ERROR_CODES.PROVIDER_UNKNOWN_SLUG,
          `Provider "${provider.slug}" cannot be enabled: ${failure.error}`,
          409,
          { slug: provider.slug, reason: failure.error },
        );
      }
    }

    return client.provider.update({ where: { id }, data: { isEnabled: enabled } });
  }

  /**
   * Shapes a row for the admin API — §19.3, an allowlist rather than a
   * blocklist, so a column added later does not become public by accident.
   *
   * Merges the stored row with what the registry knows about the code behind
   * it. The two halves stay distinguishable on purpose: a row whose adapter
   * is missing must not render as an ordinary provider, because that is
   * precisely the state someone is trying to find.
   */
  toSummary(provider: Provider): ProviderSummary {
    const registered = this.registry.find(provider.slug);
    const failure = this.registry.failures().find((f) => f.slug === provider.slug);

    return {
      id: provider.id,
      slug: provider.slug,
      displayName: provider.displayName,
      isEnabled: provider.isEnabled,
      healthState: provider.healthState,
      consecutiveFailureCount: provider.consecutiveFailureCount,
      lastSuccessfulSyncAt: provider.lastSuccessfulSyncAt?.toISOString() ?? null,
      syncIntervalMinutes: provider.syncIntervalMinutes,
      postbackIpRanges: provider.postbackIpRanges,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),

      adapterRegistered: registered !== undefined,
      registrationError: failure?.error ?? null,
      capabilities: registered ? [...registered.adapter.metadata.capabilities] : [],
      postbackSigningScheme: registered?.adapter.metadata.postbackSigningScheme ?? null,
    };
  }
}

function providerNotFound(id: string): DomainError {
  return new DomainError(ERROR_CODES.PROVIDER_NOT_FOUND, 'Provider not found', 404, { id });
}

function requireDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new ValidationError('Invalid provider display name', [
      { field: 'displayName', message: 'must be between 1 and 100 characters' },
    ]);
  }
  return trimmed;
}

function validateSyncInterval(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;

  if (
    !Number.isInteger(value) ||
    value < MIN_SYNC_INTERVAL_MINUTES ||
    value > MAX_SYNC_INTERVAL_MINUTES
  ) {
    throw new ValidationError('Invalid sync interval', [
      {
        field: 'syncIntervalMinutes',
        message: `must be an integer between ${MIN_SYNC_INTERVAL_MINUTES} and ${MAX_SYNC_INTERVAL_MINUTES}`,
      },
    ]);
  }

  return value;
}

/**
 * Validates and de-duplicates postback source ranges.
 *
 * Rejected on write rather than at verification time. A malformed range does
 * not fail loudly when a postback arrives — it simply matches nothing, so
 * every postback from a legitimate provider is quarantined, and the reason
 * lives in a config field nobody thinks to re-read.
 */
function normalizeIpRanges(ranges: string[] | undefined): string[] {
  if (ranges === undefined) return [];

  if (ranges.length > MAX_IP_RANGES) {
    throw new ValidationError('Too many postback IP ranges', [
      { field: 'postbackIpRanges', message: `at most ${MAX_IP_RANGES} ranges` },
    ]);
  }

  const seen = new Set<string>();
  const invalid: string[] = [];

  for (const raw of ranges) {
    const range = raw.trim();
    if (!isValidIpRange(range)) {
      invalid.push(raw);
      continue;
    }
    seen.add(range);
  }

  if (invalid.length > 0) {
    throw new ValidationError('Invalid postback IP ranges', [
      {
        field: 'postbackIpRanges',
        message: `not valid addresses or CIDR blocks: ${invalid.join(', ')}`,
      },
    ]);
  }

  return [...seen];
}

export const __testing = {
  normalizeIpRanges,
  validateSyncInterval,
  requireDisplayName,
  MIN_SYNC_INTERVAL_MINUTES,
  MAX_SYNC_INTERVAL_MINUTES,
};
