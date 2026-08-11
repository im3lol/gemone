/**
 * Offer catalog contracts — the internal model every provider maps into.
 *
 * ARCHITECTURE.md §7.5 and PROJECT.md §1: the platform owns no inventory, and
 * its value is aggregation — one unified catalog assembled from several
 * provider catalogs. That only works if there is exactly one shape downstream,
 * and nothing in this file could tell you which network an offer came from.
 */

/**
 * Our fixed category set.
 *
 * Providers each ship their own vocabulary — `mobile_game`, `ios`, `gaming`,
 * `app` may all mean the same thing to a user. Mapping onto a closed set is a
 * business rule owned by `offers`, not by an adapter (§7.5): an adapter that
 * guessed would put a business rule inside a provider folder where nobody can
 * change it.
 *
 * `OTHER` exists so an unrecognised category is never a reason to drop a
 * paying offer. A missing category costs a filter; a dropped offer costs
 * revenue.
 */
export const OFFER_CATEGORIES = {
  GAME: 'GAME',
  SURVEY: 'SURVEY',
  SIGNUP: 'SIGNUP',
  TRIAL: 'TRIAL',
  SHOPPING: 'SHOPPING',
  APP_INSTALL: 'APP_INSTALL',
  VIDEO: 'VIDEO',
  OTHER: 'OTHER',
} as const;

export type OfferCategory = (typeof OFFER_CATEGORIES)[keyof typeof OFFER_CATEGORIES];

/**
 * Who switched an offer off.
 *
 * Not cosmetic. An offer an admin removed must not come back because the next
 * sync still sees it in the provider's catalog — which is exactly what would
 * happen if deactivation were a single boolean.
 */
export const OFFER_DEACTIVATION_SOURCES = {
  /** Absent from a full catalog sync. Reversible by the provider listing it again. */
  SYNC: 'SYNC',
  /** An admin's decision. Only an admin can undo it. */
  ADMIN: 'ADMIN',
} as const;

export type OfferDeactivationSource =
  (typeof OFFER_DEACTIVATION_SOURCES)[keyof typeof OFFER_DEACTIVATION_SOURCES];

/**
 * How much of the provider's catalog a run is authoritative about.
 *
 * The distinction is *only* about pruning, and that is the whole point:
 * deactivating an offer because it was absent is safe only when absence is
 * meaningful.
 */
export const SYNC_MODES = {
  /** Fetch and upsert. Never deactivates anything. */
  INCREMENTAL: 'INCREMENTAL',
  /** Fetch, upsert, and deactivate whatever this run did not see. */
  FULL: 'FULL',
} as const;

export type SyncMode = (typeof SYNC_MODES)[keyof typeof SYNC_MODES];

export const SYNC_OUTCOMES = {
  /** The row is created before the work starts, so a crashed run is visible. */
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  /** Completed, but something was skipped — most often a refused prune. */
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;

export type SyncOutcome = (typeof SYNC_OUTCOMES)[keyof typeof SYNC_OUTCOMES];

/**
 * Why a normalized offer was refused.
 *
 * Counted per run rather than logged and forgotten. "The catalog is smaller
 * than yesterday" is a question that gets asked, and an answer of
 * `CURRENCY_NOT_SUPPORTED: 412` is one somebody can act on.
 */
export const OFFER_REJECTION_REASONS = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_PAYOUT: 'INVALID_PAYOUT',
  CURRENCY_NOT_SUPPORTED: 'CURRENCY_NOT_SUPPORTED',
  /** The configured rate rounds this payout down to nothing. */
  REWARD_TOO_SMALL: 'REWARD_TOO_SMALL',
  NO_TARGET_DEVICE: 'NO_TARGET_DEVICE',
  /** Two offers in one response claiming the same external id. */
  DUPLICATE_EXTERNAL_ID: 'DUPLICATE_EXTERNAL_ID',
} as const;

export type OfferRejectionReason =
  (typeof OFFER_REJECTION_REASONS)[keyof typeof OFFER_REJECTION_REASONS];

/** One offer, as the API returns it. */
export interface OfferSummary {
  id: string;
  providerId: string;
  providerSlug: string;
  externalId: string;

  title: string;
  description: string | null;
  requirements: string | null;

  /** What the provider pays us, in minor units. Admin-facing. */
  payoutAmountMinor: number;
  payoutCurrency: string;
  /** What the user earns. The only number a user is ever shown. */
  rewardPoints: number;

  category: OfferCategory;
  providerCategories: string[];
  countries: string[];
  devices: string[];

  imageUrl: string | null;
  isMultiStep: boolean;

  isActive: boolean;
  deactivatedAt: string | null;
  deactivationSource: OfferDeactivationSource | null;

  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

/** One synchronization attempt — the data behind provider health. */
export interface SyncRunSummary {
  id: string;
  providerId: string;
  providerSlug: string;
  mode: SyncMode;
  outcome: SyncOutcome;

  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;

  offersFetched: number;
  offersAccepted: number;
  offersRejected: number;
  offersCreated: number;
  offersUpdated: number;
  offersDeactivated: number;

  /** Reason → count. Empty when nothing was refused. */
  rejections: Partial<Record<OfferRejectionReason, number>>;

  /** One line, safe to show an admin. Full detail is in the logs. */
  errorSummary: string | null;
}

export interface ListOffersQuery {
  providerId?: string;
  isActive?: boolean;
  category?: OfferCategory;
  country?: string;
  limit?: number;
  offset?: number;
}

// --- The offer wall — PROJECT.md §3.2, milestone M2 -------------------------

/**
 * One offer as a **user** sees it.
 *
 * Deliberately a different type from `OfferSummary`, not a subset of it —
 * §19.3's allowlist applied to the surface where it matters most. Two fields
 * are the reason this type exists at all:
 *
 * - **`payoutAmountMinor` / `payoutCurrency` are absent.** What a provider pays
 *   us is our commercial relationship. Shown next to what the user earns, it
 *   is also an invitation to work out the margin on every offer on the wall.
 * - **`trackingUrlTemplate` is absent**, as it is from `OfferSummary`. It is
 *   how a click is constructed server-side, and a user holding it could
 *   generate their own tracking links.
 *
 * Also absent, for the same reason but with lower stakes: `providerId` (an
 * internal uuid; the slug is the public handle), `externalId` (the provider's
 * own key), and every lifecycle column — `isActive`, `deactivatedAt`,
 * `lastSeenAt` and the timestamps — because the wall only ever shows live
 * offers, so a user reading them would be reading a constant.
 *
 * A subset type derived with `Omit<OfferSummary, …>` was rejected: it inverts
 * the safety. A field added to `OfferSummary` for an admin screen would appear
 * on the wall automatically, and the failure would be silent. Listing what a
 * user may see means a new field is invisible until somebody adds it here.
 */
export interface WallOffer {
  id: string;
  /**
   * Which network the offer came from.
   *
   * Included, unlike the payout: it is not commercially sensitive, and it is
   * the first thing a support conversation needs when a user says an offer did
   * not credit. P1 is about code not knowing which provider it is talking to;
   * it has never been about hiding the name from a user.
   *
   * The slug stays because it is the stable handle: it is what a support
   * ticket quotes, what a URL would carry, and what the postback path is named
   * after. `providerName` below is what a person reads.
   */
  providerSlug: string;

  /**
   * The provider's name, as an admin set it — `providers.display_name`.
   *
   * Resolved from the in-memory registry the wall already consults to decide
   * which providers are eligible (TODO T82), so it costs **no query and no
   * join**: the same lookup that produced the slug produces this.
   *
   * It exists because a slug is not a name. `adgem` title-cased is "Adgem",
   * and the alternative to carrying the real one is a map of provider names in
   * the browser — which is both a second source of truth and precisely the
   * "code knows which provider it is talking to" that P1 forbids.
   */
  providerName: string;

  title: string;
  description: string | null;
  requirements: string | null;

  /** The only number a user is ever shown. */
  rewardPoints: number;

  category: OfferCategory;
  /** ISO-3166 alpha-2. Empty means the provider declared no restriction. */
  countries: string[];
  devices: string[];

  imageUrl: string | null;
  isMultiStep: boolean;
}

/**
 * How the wall is ordered.
 *
 * A closed set rather than a free-form `sortBy` / `direction` pair, because an
 * open sort parameter is an index nobody planned and a column name from a
 * client reaching the query builder.
 */
export const WALL_OFFER_SORTS = {
  /** Highest paying first. The default — it is what a user opens the wall for. */
  REWARD_DESC: 'reward_desc',
  REWARD_ASC: 'reward_asc',
  /** Most recently added to our catalog. */
  NEWEST: 'newest',
} as const;

export type WallOfferSort = (typeof WALL_OFFER_SORTS)[keyof typeof WALL_OFFER_SORTS];

export interface ListWallOffersQuery {
  category?: OfferCategory;
  /** Case-insensitive substring over the title. */
  search?: string;
  /** Inclusive bounds on what the user would earn. */
  minRewardPoints?: number;
  maxRewardPoints?: number;
  /**
   * Narrows to offers the provider declared for this country or device.
   *
   * A **filter the client asks for, not a gate we enforce.** There is no
   * geo-IP source yet (TODO T17), and `users.registration_country` would
   * refuse a legitimate traveller — so eligibility stays the provider's
   * business at conversion time, and this is here to let a client show a
   * relevant wall rather than to decide who may click.
   */
  country?: string;
  device?: string;
  sort?: WallOfferSort;
  limit?: number;
  offset?: number;
}

export interface ListSyncRunsQuery {
  providerId?: string;
  outcome?: SyncOutcome;
  limit?: number;
  offset?: number;
}

export interface SetOfferActiveRequest {
  active: boolean;
  /** Mandatory. An offer that vanished without explanation is a support ticket. */
  reason: string;
}

export interface TriggerSyncRequest {
  mode: SyncMode;
}
