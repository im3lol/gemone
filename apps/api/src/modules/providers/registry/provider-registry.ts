import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type ProviderCapability,
  type ProviderCapabilityReport,
} from '@gemone/contracts';

import { DomainError } from '../../../core/errors/app-error';
import type { OfferProviderAdapter, ProviderAdapterMap } from '../contracts/provider-adapter';
import { PROVIDER_ADAPTER_MAP } from './adapter-map';
import { ProviderCredentialsResolver } from './provider-credentials';
import {
  validateAdapterImplementation,
  validateAdapterMetadata,
} from './adapter-validation';

/**
 * What the registry needs to know about a stored provider.
 *
 * A plain shape, not a Prisma row. The registry does no database access at
 * all: `ProvidersService` owns the `providers` table and feeds rows in.
 *
 * §7.3 describes the registry as reading the table itself. This is the same
 * behaviour with the dependency pointing the other way, and it buys two
 * things. The service must validate a slug against the adapter map on every
 * write, so a registry that queried the table would close a cycle that
 * NestJS resolves with `forwardRef()` and that quietly makes both untestable
 * in isolation — the exact trap §4.2 documents for `fraud`. And a registry
 * fed plain objects is testable with plain objects.
 */
export interface ProviderRegistration {
  id: string;
  slug: string;
  displayName: string;
  isEnabled: boolean;
}

/** A provider whose adapter is live and usable. */
export interface RegisteredProvider extends ProviderRegistration {
  adapter: OfferProviderAdapter;
}

/**
 * A provider row whose adapter could not be brought up.
 *
 * Kept rather than discarded. A row that vanishes from the registry with no
 * trace is a provider that "stopped working" with nothing to point at; this
 * carries the reason all the way to the admin screen.
 */
export interface FailedProvider extends ProviderRegistration {
  error: string;
}

/**
 * The only place that knows concrete adapters exist — ARCHITECTURE.md §7.3.
 *
 * Holds an in-memory snapshot: slug → live adapter. Lookup by slug and
 * enumeration of enabled providers are the two operations every downstream
 * feature needs, and neither should cost a query on the click path.
 *
 * MULTI-PROCESS BEHAVIOUR: `load()` swaps in whatever rows it is handed and
 * knows nothing about where they came from. Every process holds its own
 * snapshot; keeping them in agreement is `ProvidersService`'s job, which
 * broadcasts on the §14.3 channel after a write and reloads on receipt. That is
 * what makes §7.3's "cutting off a misbehaving provider takes seconds" true on
 * every process rather than only on the one an admin happened to reach.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);

  private registered = new Map<string, RegisteredProvider>();
  private failed = new Map<string, FailedProvider>();
  private loaded = false;

  constructor(
    @Inject(PROVIDER_ADAPTER_MAP) private readonly adapters: ProviderAdapterMap,
    private readonly credentials: ProviderCredentialsResolver,
  ) {}

  /**
   * Rebuilds the snapshot from the given rows.
   *
   * Builds into fresh maps and swaps them at the end, rather than mutating in
   * place. A concurrent lookup during a reload would otherwise see a registry
   * that is half old and half new — and on the click path that means a user
   * redirected using a provider's previous configuration.
   */
  load(rows: readonly ProviderRegistration[]): void {
    const registered = new Map<string, RegisteredProvider>();
    const failed = new Map<string, FailedProvider>();

    for (const row of rows) {
      const outcome = this.build(row);

      if ('error' in outcome) {
        failed.set(row.slug, outcome);
        // Error, not warn: a provider row exists that the running build
        // cannot serve. Either a slug was removed from the code or a
        // credential is missing from this deployment, and both are somebody's
        // action item rather than background noise.
        this.logger.error(
          { slug: row.slug, providerId: row.id, reason: outcome.error },
          'Provider adapter could not be registered',
        );
        continue;
      }

      registered.set(row.slug, outcome);
    }

    this.registered = registered;
    this.failed = failed;
    this.loaded = true;

    this.logger.log(
      {
        registered: registered.size,
        enabled: [...registered.values()].filter((p) => p.isEnabled).length,
        failed: failed.size,
      },
      'Provider registry loaded',
    );
  }

  /** True once `load()` has run. Distinguishes "no providers" from "not loaded yet". */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Every provider with a working adapter, enabled or not. */
  all(): RegisteredProvider[] {
    return [...this.registered.values()];
  }

  /**
   * The providers that may actually be used — §7.3's "a disabled provider is
   * inert".
   *
   * Filtered on `isEnabled` only, never on health. Excluding an unhealthy
   * provider here would be a trap with no exit: nothing would call it, so
   * nothing would record a success, so it could never leave the DOWN state on
   * its own. Health informs an operator; `isEnabled` is the decision.
   */
  enabled(): RegisteredProvider[] {
    return this.all().filter((provider) => provider.isEnabled);
  }

  /** Rows whose adapter could not be registered, with the reason. */
  failures(): FailedProvider[] {
    return [...this.failed.values()];
  }

  /** Undefined for an unknown, disabled, or unregistrable slug. */
  find(slug: string): RegisteredProvider | undefined {
    return this.registered.get(slug);
  }

  /**
   * Resolves a slug to a usable adapter, or explains precisely why not.
   *
   * Three distinct failures rather than one "provider unavailable": an
   * unknown slug is a bug in the caller, a disabled provider is an operator's
   * decision, and a registration failure is a deployment problem. Collapsing
   * them would mean reading logs to tell a typo from a deliberate shutdown.
   */
  require(slug: string): RegisteredProvider {
    const provider = this.registered.get(slug);
    if (provider) {
      if (!provider.isEnabled) {
        throw new DomainError(
          ERROR_CODES.PROVIDER_DISABLED,
          `Provider "${slug}" is disabled`,
          409,
          { slug },
        );
      }
      return provider;
    }

    const failure = this.failed.get(slug);
    if (failure) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_UNKNOWN_SLUG,
        `Provider "${slug}" has no usable adapter`,
        409,
        { slug, reason: failure.error },
      );
    }

    throw new DomainError(
      ERROR_CODES.PROVIDER_NOT_FOUND,
      `Provider "${slug}" is not registered`,
      404,
      { slug },
    );
  }

  /**
   * Capability discovery — the alternative to branching on a provider's name.
   *
   * This method is what makes §5 rule 7 keepable. Code that needs to know
   * whether reversals are supported asks; the moment it instead writes
   * `if (slug === 'someprovider')`, provider knowledge has escaped its folder
   * and P1 is over.
   *
   * An unknown or unregistrable provider supports nothing, rather than
   * throwing: "can it do X" has a correct answer for a provider that is not
   * there, and it is no.
   */
  supports(slug: string, capability: ProviderCapability): boolean {
    const provider = this.registered.get(slug);
    return provider?.adapter.metadata.capabilities.includes(capability) ?? false;
  }

  /** Asserts a capability, for callers that cannot proceed without it. */
  requireCapability(slug: string, capability: ProviderCapability): RegisteredProvider {
    const provider = this.require(slug);

    if (!provider.adapter.metadata.capabilities.includes(capability)) {
      throw new DomainError(
        ERROR_CODES.PROVIDER_CAPABILITY_UNSUPPORTED,
        `Provider "${slug}" does not support "${capability}"`,
        409,
        { slug, capability },
      );
    }

    return provider;
  }

  /**
   * What every adapter in this build declares — including the ones that could
   * not be brought up.
   *
   * Reads the *map*, not the loaded snapshot, so it answers "what can this
   * deployment support" rather than "what is switched on". That is the
   * question an operator adding a provider is actually asking, and it has an
   * answer before any row exists.
   */
  describeAdapters(): ProviderCapabilityReport[] {
    return Object.entries(this.adapters).map(([slug, definition]) => {
      const { metadata } = definition;
      const { missing } = this.credentials.resolve(slug, metadata.requiredCredentials);

      return {
        slug,
        displayName: metadata.displayName,
        capabilities: [...metadata.capabilities],
        postbackSigningScheme: metadata.postbackSigningScheme,
        publishedIpRanges: [...metadata.publishedIpRanges],

        // Variable NAMES, never values — at any role level (§19.3). An admin
        // needs to know which variables to set; nobody needs the secrets read
        // back to them.
        requiredCredentialVariables: metadata.requiredCredentials.map((credential) =>
          ProviderCredentialsResolver.variableName(slug, credential),
        ),

        registered: this.registered.has(slug),
        registrationError:
          this.failed.get(slug)?.error ??
          (missing.length > 0 ? `missing environment: ${missing.join(', ')}` : null),
      };
    });
  }

  /** Slugs this build has an adapter for. The set a provider row may name. */
  knownSlugs(): string[] {
    return Object.keys(this.adapters);
  }

  hasAdapterFor(slug: string): boolean {
    return Object.hasOwn(this.adapters, slug);
  }

  /**
   * Brings one row up: resolve the definition, validate it, resolve
   * credentials, construct, validate the instance.
   *
   * Ordered so nothing is constructed before its declaration is trusted. In
   * particular, credentials are resolved from the *declared* list, which
   * cannot be read from an instance that has not been built yet — hence
   * metadata living on the definition rather than only on the adapter.
   */
  private build(row: ProviderRegistration): RegisteredProvider | FailedProvider {
    const definition = this.adapters[row.slug];

    if (!definition) {
      /*
       * Rejected on write, so reaching this at runtime means the code was
       * removed from underneath an existing row.
       *
       * The row is made inert and the process keeps running, rather than the
       * boot failing. A deleted adapter must not take down withdrawals,
       * logins and every other provider with it — and a process that refuses
       * to start is the one failure mode nobody can mitigate at 2 a.m.
       */
      return { ...row, error: `no adapter is registered for slug "${row.slug}"` };
    }

    const metadataCheck = validateAdapterMetadata(row.slug, definition.metadata);
    if (!metadataCheck.valid) {
      return { ...row, error: metadataCheck.problems.join('; ') };
    }

    const { credentials, missing } = this.credentials.resolve(
      row.slug,
      definition.metadata.requiredCredentials,
    );

    if (missing.length > 0) {
      // Named explicitly. "Provider misconfigured" costs someone an hour;
      // "PROVIDER_MOCK_SECRET is not set" costs them a minute.
      return { ...row, error: `missing environment variables: ${missing.join(', ')}` };
    }

    let adapter: OfferProviderAdapter;
    try {
      adapter = definition.create({ slug: row.slug, credentials });
    } catch (error) {
      // A `create` implementation is documented not to throw. Caught anyway:
      // one adapter's constructor bug must not prevent every other provider
      // from loading.
      return {
        ...row,
        error: `adapter construction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const implementationCheck = validateAdapterImplementation(adapter);
    if (!implementationCheck.valid) {
      return { ...row, error: implementationCheck.problems.join('; ') };
    }

    return { ...row, adapter };
  }
}
