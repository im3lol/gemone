/**
 * Infrastructure the BFF needs — ARCHITECTURE.md §5.1.
 *
 * Read from `process.env` rather than `$env/dynamic/private`, which is the
 * usual SvelteKit route. Two reasons: this module is under `lib/server`, so
 * SvelteKit already refuses to bundle it into anything the browser receives —
 * the guarantee `$env/dynamic/private` exists to provide — and `process.env`
 * leaves everything that reads it testable without SvelteKit's virtual
 * modules.
 *
 * Same rule as `apps/api`: infrastructure only. A business rule that appeared
 * here would be a P3 violation, and it would be one this app cannot even fix,
 * because `web` has no database and no ConfigurationService.
 */

/**
 * Where the API lives, on the internal network.
 *
 * No default. §6.1's proxy is the only route to the API, so a `web` that
 * silently pointed at localhost would be a `web` that appears to start and
 * fails every request — which is worse than not starting.
 */
export function apiBaseUrl(): string {
  const value = process.env.API_URL;

  if (!value) {
    throw new Error('API_URL is not set — web cannot reach the API without it');
  }

  return value.replace(/\/+$/, '');
}

/**
 * Whether cookies are marked `Secure`.
 *
 * Tied to `NODE_ENV` rather than to a flag of its own, because the only reason
 * to send a session cookie over plain HTTP is a developer on localhost, and
 * that is exactly what `NODE_ENV !== 'production'` means here. In production
 * Caddy terminates TLS (§19.1), so the cookie has no business travelling
 * unencrypted.
 */
export function useSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}
