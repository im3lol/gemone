/**
 * Administrative configuration — P3's second half.
 *
 * PROJECT.md §3.2: an admin can "adjust reward rates, hold periods, withdrawal
 * limits, daily limits, fraud thresholds, currencies — **without a
 * developer**." The store, the typing, the validation and the history have
 * existed since Feature 4; these are the shapes that finally expose them.
 *
 * ARCHITECTURE.md §5.2 draws the boundary this must not cross: configuration is
 * a typed key-value store with scoped resolution and an audit trail, not a
 * feature-flag platform. Nothing here lets a caller invent a key.
 */

/** The two levels of the resolution chain (§4.9). */
export const CONFIG_SCOPES = {
  GLOBAL: 'GLOBAL',
  /** Overrides GLOBAL for one provider. Networks differ; the chain lets them. */
  PROVIDER: 'PROVIDER',
} as const;

export type ConfigScopeName = (typeof CONFIG_SCOPES)[keyof typeof CONFIG_SCOPES];

/**
 * Where a resolved value came from.
 *
 * `default` means no row exists at any scope — the value is the one code
 * declares, which is the only case where changing code changes behaviour.
 * Surfacing it is the point: an admin who cannot tell an explicit setting from
 * an unset one cannot change either safely (§4.9).
 */
export const CONFIG_SOURCES = {
  PROVIDER: 'PROVIDER',
  GLOBAL: 'GLOBAL',
  DEFAULT: 'default',
} as const;

export type ConfigSource = (typeof CONFIG_SOURCES)[keyof typeof CONFIG_SOURCES];

/** A key as an admin browses the list. */
export interface AdminConfigurationKeySummary {
  key: string;
  /** Required at registration — an unexplained key is unusable. */
  description: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  /** Scopes this key may be set at. Setting one elsewhere is refused. */
  scopes: ConfigScopeName[];
  /** What code declares when nothing is stored. */
  defaultValue: unknown;
  /** The value in force at GLOBAL scope, and whether anything is stored. */
  effectiveValue: unknown;
  source: ConfigSource;
  /** How many provider-scoped overrides exist for this key. */
  overrideCount: number;
}

/** One stored row — an explicit setting at one scope. */
export interface ConfigurationOverride {
  scope: ConfigScopeName;
  /** Empty for GLOBAL. The provider id otherwise. */
  scopeId: string;
  value: unknown;
  /**
   * Whether the resolution chain will actually use this row.
   *
   * False when the stored value no longer satisfies its key's schema — which
   * happens when a key's shape changes in a release while a value is stored
   * under the old one. Such a row is ignored on read and the chain falls
   * through to the next level, so without this flag the screen would show a
   * live-looking override beside an effective value that came from elsewhere.
   */
  valid: boolean;
  /** An admin id, or `system` / `migration` for a non-human writer. */
  updatedBy: string | null;
  updatedAt: string;
}

export interface ConfigurationHistoryEntry {
  /**
   * Which scope changed.
   *
   * Carried because a key with both a GLOBAL value and provider overrides has
   * one timeline covering all of them, and "changed from 30 to 60" is
   * unreadable without knowing which of them moved.
   */
  scope: ConfigScopeName;
  scopeId: string;
  /** Null when nothing was stored before — the value was inherited or default. */
  oldValue: unknown;
  /** Null when the override was removed, returning the key to its chain. */
  newValue: unknown;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

/** A key in full, as the detail screen shows it. */
export interface AdminConfigurationKeyDetail extends AdminConfigurationKeySummary {
  /** Every explicit setting, GLOBAL first. */
  overrides: ConfigurationOverride[];
  history: ConfigurationHistoryEntry[];
  /**
   * The value that would be used for the requested `scopeId`, resolved through
   * the chain — present only when the caller asked about a specific scope.
   */
  resolvedForScope: {
    scopeId: string;
    value: unknown;
    source: ConfigSource;
  } | null;
}

export interface SetConfigurationRequest {
  /**
   * The new value, validated against the key's registered schema before it is
   * stored. Untyped here on purpose: the schema lives with the key that owns
   * the rule, not in a wire contract that would have to enumerate every one.
   */
  value: unknown;
  /** Defaults to GLOBAL. */
  scope?: ConfigScopeName;
  /** Required when scope is PROVIDER, refused otherwise. */
  scopeId?: string;
  /**
   * Mandatory.
   *
   * A configuration change alters economics or user-visible behaviour with no
   * deployment and no code review behind it. "Why" is the only part of that
   * record a person can write, and the column has been waiting for it since
   * Feature 4.
   */
  reason: string;
}

export interface ResetConfigurationRequest {
  scope?: ConfigScopeName;
  scopeId?: string;
  reason: string;
}

export interface AdminListConfigurationQuery {
  /** Case-insensitive prefix or substring over the key name. */
  search?: string;
  /** Only keys with something explicitly stored. */
  overriddenOnly?: boolean;
}

export interface AdminConfigurationKeyList {
  items: AdminConfigurationKeySummary[];
  total: number;
}
