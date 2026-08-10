/**
 * A dependency that must be reachable before this process should be sent
 * traffic — ARCHITECTURE.md §17.2.
 *
 * Each dependency registers itself with `HealthService.register()` from its
 * own module, so `core/health` keeps knowing nothing about Postgres, Redis,
 * or anything else it reports on. Adding a dependency is a registration in
 * that dependency's module, not an edit to the health endpoint.
 *
 * Note: an earlier draft used a `multi: true` DI token for this. NestJS has
 * no multi-provider concept — that is Angular — so registration is explicit.
 */
export interface ReadinessCheck {
  /**
   * Used in logs only, never returned to the caller (§17.2), and used as the
   * registration key so that re-registering the same dependency is a no-op.
   */
  readonly name: string;

  /** Resolves true when the dependency is reachable. Must not throw. */
  isReady(): Promise<boolean>;
}
