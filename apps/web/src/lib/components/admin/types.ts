import type { AdminPayoutSummary } from '@gemone/contracts';

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
