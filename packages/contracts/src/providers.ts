/**
 * Provider contracts — the API's public vocabulary for offerwall networks.
 *
 * ARCHITECTURE.md §7 is the design authority. Nothing here names a concrete
 * network: a provider is a slug, a set of capabilities, and an operational
 * state. That is the whole of P1 expressed as types — a client rendering the
 * admin provider screen does not know AdGem from Torox, and neither does any
 * shape in this file.
 */

/**
 * Operational health, persisted rather than computed (DATABASE.md §3.2).
 *
 * A *signal*, not a switch. `DOWN` does not stop a provider being called —
 * see the note on `isEnabled` below for why that distinction matters.
 */
export const PROVIDER_HEALTH_STATES = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
} as const;

export type ProviderHealthState =
  (typeof PROVIDER_HEALTH_STATES)[keyof typeof PROVIDER_HEALTH_STATES];

/**
 * What an adapter can do.
 *
 * The first four are the capabilities ARCHITECTURE.md §7.1 requires of every
 * adapter; they are declared rather than assumed so that validation can check
 * a declaration against an implementation (an adapter that claims a capability
 * it did not implement fails at registration, not at 3 a.m. during a sync).
 *
 * The rest are genuinely optional, and are what "capability discovery" is
 * for: a caller asks whether a provider supports reversals instead of
 * branching on its slug — which is exactly the branch P1 forbids (§5, rule 7).
 */
export const PROVIDER_CAPABILITIES = {
  FETCH_OFFERS: 'fetch_offers',
  BUILD_CLICK_URL: 'build_click_url',
  VERIFY_POSTBACK: 'verify_postback',
  PARSE_POSTBACK: 'parse_postback',

  /** The provider sends chargeback/reversal postbacks for credited conversions. */
  REVERSALS: 'reversals',
  /** `fetchOffers` honours the country/device targeting context it is given. */
  OFFER_TARGETING: 'offer_targeting',
} as const;

export type ProviderCapability =
  (typeof PROVIDER_CAPABILITIES)[keyof typeof PROVIDER_CAPABILITIES];

/** Every adapter must declare and implement these four (§7.1). */
export const MANDATORY_PROVIDER_CAPABILITIES = [
  PROVIDER_CAPABILITIES.FETCH_OFFERS,
  PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
  PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
  PROVIDER_CAPABILITIES.PARSE_POSTBACK,
] as const;

/**
 * How a provider authenticates its postbacks.
 *
 * Declared as metadata so the postback surface can report *which* scheme
 * rejected a request without the conversions module learning any provider's
 * signing algorithm — the algorithm itself stays inside the adapter (§7.1).
 */
export const POSTBACK_SIGNING_SCHEMES = {
  /** HMAC over an agreed canonical string, compared in constant time. */
  HMAC_SHA256: 'hmac_sha256',
  /** A shared secret passed as a parameter. Weak, and some networks use it. */
  SHARED_SECRET: 'shared_secret',
  /** Source IP is the only assurance. Weakest; requires published ranges. */
  IP_ALLOWLIST: 'ip_allowlist',
} as const;

export type PostbackSigningScheme =
  (typeof POSTBACK_SIGNING_SCHEMES)[keyof typeof POSTBACK_SIGNING_SCHEMES];

/** Device classes an offer can target. */
export const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
} as const;

export type DeviceType = (typeof DEVICE_TYPES)[keyof typeof DEVICE_TYPES];

/**
 * A provider as the admin panel sees it: the stored row plus what the
 * registry knows about the code behind it.
 *
 * The two halves are deliberately distinguishable. A row can exist whose
 * adapter does not (a slug removed from the code, a credential missing from
 * the environment), and an admin screen that showed such a provider as
 * ordinary would hide the exact failure someone is looking for.
 */
export interface ProviderSummary {
  id: string;
  slug: string;
  displayName: string;

  /**
   * The switch. A disabled provider is inert (§7.3): not synced, excluded
   * from the wall, and its postbacks rejected.
   *
   * Separate from `healthState` on purpose. Auto-disabling on poor health
   * would be a trap: nothing would then call the provider, so nothing would
   * ever record a success, and it could never recover on its own.
   */
  isEnabled: boolean;

  healthState: ProviderHealthState;
  consecutiveFailureCount: number;
  lastSuccessfulSyncAt: string | null;
  syncIntervalMinutes: number;

  /** Published source ranges, as IPv4/IPv6 addresses or CIDR blocks. */
  postbackIpRanges: string[];

  createdAt: string;
  updatedAt: string;

  // --- Registry-derived, not stored ---------------------------------------

  /** False when no adapter backs this slug in the running build. */
  adapterRegistered: boolean;

  /** Why registration failed, when it did. Null when the adapter is live. */
  registrationError: string | null;

  capabilities: ProviderCapability[];
  postbackSigningScheme: PostbackSigningScheme | null;
}

/**
 * What an adapter declares about itself — the answer to "what can this
 * provider do and what does it need".
 */
export interface ProviderCapabilityReport {
  slug: string;
  displayName: string;
  capabilities: ProviderCapability[];
  postbackSigningScheme: PostbackSigningScheme;
  /** The provider's published source ranges, from the adapter, not the row. */
  publishedIpRanges: string[];
  /**
   * Environment variable names this adapter needs. Names only — a value is
   * never serialised, at any role level (§19.3).
   */
  requiredCredentialVariables: string[];
  /** False when the adapter is present but its environment is incomplete. */
  registered: boolean;
  registrationError: string | null;
}

export interface CreateProviderRequest {
  /** Must match an adapter registered in the build (§7.3). */
  slug: string;
  displayName: string;
  syncIntervalMinutes?: number;
  postbackIpRanges?: string[];
}

export interface UpdateProviderRequest {
  displayName?: string;
  syncIntervalMinutes?: number;
  postbackIpRanges?: string[];
}

export interface SetProviderEnabledRequest {
  enabled: boolean;
  /** Mandatory. Cutting a provider off is an action someone asks about later. */
  reason: string;
}

export interface ListProvidersQuery {
  isEnabled?: boolean;
  healthState?: ProviderHealthState;
}
