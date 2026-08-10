import type { ZodType } from 'zod';

/**
 * A registered configuration key — the definition P3 validates against.
 *
 * Keys are *declared* by the module that owns the rule and registered at
 * startup. A value cannot be written for an unregistered key, which is what
 * keeps this a typed key-value store rather than a free-form settings bag
 * (ARCHITECTURE.md §4.9).
 *
 * NOTE: no business keys are registered yet. P3's list — reward rates, hold
 * periods, withdrawal limits, daily limits, fraud thresholds, currencies —
 * arrives with the features that own each rule, so that a key and the code
 * reading it land together.
 */
export interface ConfigurationKeyDefinition<T = unknown> {
  /** Dotted, lowercase, namespaced by owning concern: `rewards.hold_period_days`. */
  key: string;

  /**
   * Validates on write. A malformed reward rate is rejected at the admin
   * panel, not discovered in production (§4.9).
   */
  schema: ZodType<T>;

  /**
   * The value in force when nothing is stored.
   *
   * P3 permits code to define a *default*; it never permits code to define
   * the value in force. Once a row exists it wins, at every scope.
   */
  defaultValue: T;

  /** Shown in the admin panel. Required — an unexplained key is unusable. */
  description: string;

  /**
   * Scopes at which this key may be set. A key that is meaningless per
   * provider must not be settable per provider, or the resolution chain
   * silently returns a value nobody intended.
   */
  scopes: ConfigScope[];

  /** Declared type, stored alongside the value for admin rendering. */
  valueType: 'string' | 'number' | 'boolean' | 'json';
}

export type ConfigScope = 'GLOBAL' | 'PROVIDER';

/** Where a resolved value came from — surfaced by effective-value inspection. */
export interface ResolvedConfiguration<T> {
  key: string;
  value: T;
  /** `default` means no row exists at any scope in the chain. */
  source: 'PROVIDER' | 'GLOBAL' | 'default';
  scopeId: string | null;
}
