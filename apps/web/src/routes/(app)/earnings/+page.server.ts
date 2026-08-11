import type { Paginated, RewardTransactionRecord, RewardTransactionType } from '@gemone/contracts';

import type { StatementResult } from '$lib/components/earnings';
import { LEDGER_TYPES } from '$lib/rewards/ledger';
import { apiAuthedJson } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { PageServerLoad } from './$types';

/** `GET /rewards/history` caps `limit` at 100. Twenty is a screenful. */
const PAGE_SIZE = 20;

/**
 * The statement — ARCHITECTURE.md §9, DESIGN_SYSTEM.md §12.
 *
 * ## What it does not load
 *
 * The balance. `(app)/+layout.server.ts` already has it for the topbar's pill,
 * and SvelteKit merges layout data into `data`. Before this phase, `/earnings`
 * fetched `/rewards/balance` a second time on every page of the pager — the
 * other half of TODO T74's duplicate.
 *
 * ## Streaming, and why the promise resolves instead of rejecting
 *
 * D83. The history is returned unawaited, so the balance cards paint while the
 * ledger call is still open, and a failure resolves `{ ok: false }` rather than
 * rejecting — a rejected streamed promise takes the whole page to SvelteKit's
 * error screen, and the pre-redesign version of this file answered *any* failed
 * call with `redirect(303, '/login')`, signing people out because a statement
 * endpoint had a bad minute.
 *
 * The session is still the layout's business: if `/users/me` fails there, the
 * redirect happens there, before this runs.
 *
 * ## The runtime constant this file does not import
 *
 * `LEDGER_TYPES` comes from `$lib/rewards/ledger`, not
 * `REWARD_TRANSACTION_TYPES` from `@gemone/contracts`. The latter still breaks
 * the production build (TODO T79, re-confirmed this phase: `vite build` fails
 * with *"not exported by packages/contracts/dist/index.js"* while
 * `svelte-check`, Vitest and `vite dev` all resolve it). `LEDGER_TYPES` is
 * derived from a `Record<RewardTransactionType, …>`, so it is the contract's
 * set, checked by the compiler, with no runtime import.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const type = readType(url.searchParams.get('type'));
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (type) query.set('type', type);
  if (offset > 0) query.set('offset', String(offset));

  const statement: Promise<StatementResult> = apiAuthedJson<Paginated<RewardTransactionRecord>>(
    event,
    `/rewards/history?${query}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    statement,
    type,
    offset,
    pageSize: PAGE_SIZE,
    /** What the pager must preserve. The page's own params, not the API's. */
    query: url.search,
    now: nowIso(),
  };
};

/**
 * Only a type the UI knows about survives.
 *
 * `?type=DROP+TABLE` reaching the API would be answered with a 400 and turn
 * into the statement's error state — a filter nobody chose, failing a page
 * that works. `LEDGER_TYPES` is the same list the filter renders, so it cannot
 * drift from what the dropdown offers.
 */
function readType(raw: string | null): RewardTransactionType | '' {
  if (!raw) return '';

  return LEDGER_TYPES.includes(raw as RewardTransactionType) ? (raw as RewardTransactionType) : '';
}

/** An unparseable offset is page one, not `NaN` rows into the ledger. */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export const __testing = { readType, readOffset };
