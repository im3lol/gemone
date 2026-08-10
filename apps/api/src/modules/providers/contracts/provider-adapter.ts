import type {
  PostbackSigningScheme,
  ProviderCapability,
} from '@gemone/contracts';

import type {
  ClickUrlContext,
  NormalizedConversion,
  NormalizedOffer,
  OfferQueryContext,
  PostbackVerification,
  RawPostbackRequest,
} from './normalized';

/**
 * The centerpiece of P1 — ARCHITECTURE.md §7.1.
 *
 * Four capabilities and some static metadata. Everything a network does that
 * is not one of these four things is that network's business, and stays
 * inside its folder.
 *
 * The rules every implementation obeys (§7.2):
 *
 *  1. **Stateless.** No database, no cache, no queue. An adapter is a
 *     translator between a provider's dialect and ours. The moment one holds
 *     state, "which replica handled it" starts mattering.
 *  2. **No cross-module imports.** `shared` and these contracts. Nothing else.
 *     Enforced in eslint.config.mjs, not just documented.
 *  3. **Credentials are injected**, resolved from the environment by the
 *     registry. An adapter never reads `process.env` itself — otherwise
 *     credential handling is duplicated per provider and audited nowhere.
 *  4. **Errors are normalized** into the four in provider-errors.ts.
 *  5. **Normalization is total** — a partially mapped offer is dropped, with
 *     the reason logged, rather than passed on.
 *  6. **Fixtures ship with the adapter**, and contract tests run against them
 *     in CI. Fixtures are how format drift gets caught before production does.
 */
export interface OfferProviderAdapter {
  readonly metadata: ProviderAdapterMetadata;

  /**
   * Called by the catalog sync job only.
   *
   * Honouring `context` is optional and declared: an adapter without the
   * `offer_targeting` capability returns its full catalog and lets `offers`
   * filter. Declaring it is what lets the caller know, rather than guess.
   */
  fetchOffers(context: OfferQueryContext): Promise<NormalizedOffer[]>;

  /**
   * **A pure function. No I/O.**
   *
   * On the redirect path, where the user is already waiting. An adapter that
   * called the network here would put a provider's latency — and its
   * outages — directly in front of every click.
   */
  buildClickUrl(context: ClickUrlContext): string;

  /**
   * Where every provider's signing scheme differs, and where that difference
   * is contained (§7.1).
   *
   * Returns a verdict rather than throwing: a forged postback on a public
   * endpoint is an expected event, not a fault, and treating it as an
   * exception fills the error log with noise that hides real failures.
   */
  verifyPostback(request: RawPostbackRequest): PostbackVerification;

  /**
   * Extracts the normalized conversion.
   *
   * Separate from `verifyPostback` on purpose. Parsing an unverified payload
   * to decide whether to verify it is how a forged field gets read before it
   * is trusted; the caller verifies first, and only then parses.
   */
  parsePostback(request: RawPostbackRequest): NormalizedConversion;
}

/** What an adapter declares about itself. Static — no I/O to read any of it. */
export interface ProviderAdapterMetadata {
  /**
   * Must equal the key this adapter is registered under. Checked at
   * registration: a mismatch means lookups by slug return an adapter that
   * signs with a different provider's scheme, which fails as "all postbacks
   * are forged" and is miserable to diagnose.
   */
  readonly slug: string;

  readonly displayName: string;

  readonly postbackSigningScheme: PostbackSigningScheme;

  /**
   * The provider's published source ranges, from the provider's docs.
   *
   * Distinct from the ranges on the `providers` row: this is what the
   * provider *says*, versioned with the code; the row is what an operator
   * decided to enforce and can change at 2 a.m. without a deploy.
   */
  readonly publishedIpRanges: readonly string[];

  /** Everything this adapter can do. Validated against what it implements. */
  readonly capabilities: readonly ProviderCapability[];

  /**
   * Credential names this adapter needs, in `snake_case`.
   *
   * Names, not values. The registry maps each to an environment variable and
   * resolves it (§7.2 rule 3); an adapter that needs a secret declares it
   * here and receives it in its context.
   */
  readonly requiredCredentials: readonly string[];
}

/**
 * What the registry hands an adapter at construction.
 *
 * The slug is passed in as well as declared in metadata so a single
 * implementation can back more than one registration — a network with
 * regional endpoints, for instance — without the adapter reading anything
 * ambient.
 */
export interface ProviderAdapterContext {
  readonly slug: string;
  /** Resolved from the environment by the registry. Never read directly. */
  readonly credentials: Readonly<Record<string, string>>;
}

/**
 * What the registry stores for one adapter: its static metadata, plus how to
 * build an instance.
 *
 * Metadata is reachable *without* constructing the adapter, deliberately.
 * The registry must know which credentials an adapter needs before it can
 * resolve them, and the alternative — construct with every environment
 * variable that happens to share the slug's prefix, then ask — hands one
 * adapter another adapter's secrets whenever one slug prefixes another
 * (`acme` and `acme-eu`). Declared credentials are resolved by exact name.
 *
 * `create` is a factory rather than a class reference because the registry
 * constructs adapters *with* their credentials. It also keeps the map free of
 * DI: adapters are plain objects with no injected dependencies, which is what
 * "stateless translator" (§7.2, rule 1) means in practice.
 *
 * A `create` implementation must not validate its credentials or throw. The
 * registry validates after construction, so that a misconfigured provider
 * becomes an inert provider with a readable reason rather than a failed boot.
 */
export interface ProviderAdapterDefinition {
  readonly metadata: ProviderAdapterMetadata;
  create(context: ProviderAdapterContext): OfferProviderAdapter;
}

/**
 * Slug → definition. **The only place that knows concrete adapters exist** (§7.3).
 *
 * Deliberately a plain map rather than filesystem scanning or decorator-based
 * auto-discovery. An explicit map is one line per provider, is greppable, and
 * fails at compile time when a slug has no adapter. Auto-discovery would be
 * cleverer and would fail at runtime, in production, on boot (P6).
 */
export type ProviderAdapterMap = Readonly<Record<string, ProviderAdapterDefinition>>;
