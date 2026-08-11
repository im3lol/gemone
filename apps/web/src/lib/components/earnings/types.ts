import type { RewardTransactionRecord } from '@gemone/contracts';

/**
 * Shared prop types for the statement — docs/UI_KIT.md.
 *
 * In a `.ts` file for the reason `ui/types.ts` records: a type declared in a
 * Svelte instance script is not reliably re-exportable, and `+page.server.ts`
 * needs the shape without importing a component.
 */

/**
 * What the streamed statement call resolves to.
 *
 * **A result, not a rejection** — D83. The promise is streamed to the browser,
 * and a rejected one takes the whole page to the error screen, discarding
 * balances that loaded perfectly well.
 *
 * `total` rides along because the pager needs it: without the count there is
 * no way to know whether a "Next" link should exist, and a Next that leads to
 * an empty page is worse than no Next.
 */
export type StatementResult =
  | { ok: true; items: RewardTransactionRecord[]; total: number }
  | { ok: false };
