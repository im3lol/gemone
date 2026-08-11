import type { PayoutSummary } from '@gemone/contracts';

/**
 * Shared prop types for the withdrawal screen — docs/UI_KIT.md.
 *
 * In a `.ts` file for the reason `ui/types.ts` records: a type declared in a
 * Svelte instance script is not reliably re-exportable, and `+page.server.ts`
 * needs the shape without importing a component.
 */

/**
 * What the streamed payout-history call resolves to.
 *
 * **A result, not a rejection** — D83. A rejected streamed promise takes the
 * whole page to SvelteKit's error screen, and on this page that would discard
 * a working withdrawal form because a *list* endpoint had a bad minute.
 *
 * `total` rides along so the table can say when it is showing a window rather
 * than everything. Silently truncating a list of someone's withdrawals reads
 * as "this is all of them".
 */
export type PayoutHistoryResult =
  | { ok: true; items: PayoutSummary[]; total: number }
  | { ok: false };

/**
 * Per-control messages, keyed by the control's `name`.
 *
 * The API's own words, placed on the field they are about. The names match the
 * DTO's properties, which is what lets a validation failure's `fields` array
 * be used without a translation table.
 */
export type WithdrawFieldErrors = {
  amountPoints?: string;
  method?: string;
  destination?: string;
};

/**
 * What the withdrawal form gets back from its own action.
 *
 * A discriminated union so the confirmation and the failure cannot be confused
 * for one another — the alternative is a bag of optional fields where
 * `submitted` being absent and the request having failed look identical.
 */
export type WithdrawResult =
  | { ok: true; payout: PayoutSummary }
  | {
      ok: false;
      /** Shown above the form. Null when a field carries the message instead. */
      message: string | null;
      fields: WithdrawFieldErrors;
      /** What was typed, so a no-JS retry does not start from an empty form. */
      values: { amountPoints: string; method: string; destination: string };
    };
