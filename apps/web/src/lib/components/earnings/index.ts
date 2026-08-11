/**
 * The earnings statement — DESIGN_SYSTEM.md §11.3, §12.
 *
 * `Statement` is the only piece a page needs; the filter, the table and the
 * pager are its parts. None of them fetches, and none decides what a movement
 * means — that lives in `$lib/rewards/ledger.ts`.
 */
export { default as BalanceSummary } from './BalanceSummary.svelte';
export { default as Statement } from './Statement.svelte';

export type { StatementResult } from './types';
