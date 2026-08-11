/**
 * The dashboard's sections — DESIGN_SYSTEM.md §16.
 *
 * Each one takes already-loaded data and renders it. None of them fetches,
 * and none of them decides what a ledger movement means — that lives in
 * `$lib/rewards/ledger.ts`, where it can be tested against a record.
 */
export { default as AccountCard } from './AccountCard.svelte';
export { default as BalanceGrid } from './BalanceGrid.svelte';
export { default as EarningsOverview } from './EarningsOverview.svelte';
export { default as RecentActivity } from './RecentActivity.svelte';

export type { ActivityResult } from './types';
