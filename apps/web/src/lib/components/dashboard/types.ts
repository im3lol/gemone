import type { RewardTransactionRecord } from '@gemone/contracts';

/**
 * Shared prop types for the dashboard sections — docs/UI_KIT.md.
 *
 * In a `.ts` file rather than beside the component for the reason `ui/types.ts`
 * records: a type declared in a Svelte instance script is not reliably
 * re-exportable, and `+page.server.ts` needs this shape without importing a
 * component.
 */

/**
 * What the dashboard's streamed history call resolves to.
 *
 * **A result, not a rejection.** The promise is streamed to the browser, and a
 * rejected one takes the whole page to the error screen; this way a failing
 * `/rewards/history` is a card that says so, on a page whose balances still
 * render.
 */
export type ActivityResult = { ok: true; items: RewardTransactionRecord[] } | { ok: false };
