import type {
  AdminPayoutSummary,
  ProviderSummary,
  SyncRunSummary,
} from '@gemone/contracts';

/**
 * Shared prop types for the admin queue — docs/UI_KIT.md.
 *
 * In a `.ts` file for the reason `ui/types.ts` records: a type declared in a
 * Svelte instance script is not reliably re-exportable, and `+page.server.ts`
 * needs the shape without importing a component.
 */

/**
 * What the streamed queue call resolves to.
 *
 * **A result, not a rejection** — D83. The pre-redesign page answered any
 * failed call with `redirect(303, '/login')`, which on an admin screen means a
 * queue endpoint having a bad minute logs the administrator out of the tool
 * they were using to investigate it.
 */
export type QueueResult =
  | { ok: true; items: AdminPayoutSummary[]; total: number }
  | { ok: false };

/**
 * What a transition action hands back.
 *
 * A discriminated union so a confirmation and a refusal cannot be confused for
 * one another — the alternative is a bag of optional fields where "nothing
 * happened" and "it failed" look identical.
 */
export type ReviewResult =
  | { ok: true; action: 'approve' | 'reject' | 'settle' | 'fail'; status: string }
  | { ok: false; action: string; message: string };

/**
 * What the streamed provider call resolves to.
 *
 * **A result, not a rejection** — D83. `GET /admin/providers` returns
 * `{ items }` with no pagination: providers are counted in single digits, and
 * a screen that paged through three of them would be ceremony.
 *
 * `runs` is the latest synchronization per provider, resolved from **one**
 * call to `/admin/catalog/sync-runs` rather than one per provider. Sync runs
 * come back newest-first, so the first occurrence of a provider id is its
 * latest run.
 */
export type ProviderResult =
  | { ok: true; items: ProviderSummary[]; runs: Record<string, SyncRunSummary> }
  | { ok: false };

/** What a provider action hands back. A discriminated union, for D83's reason. */
export type ProviderActionResult =
  | { ok: true; action: 'enable' | 'disable' | 'sync' | 'register'; message: string }
  | { ok: false; action: string; message: string };
