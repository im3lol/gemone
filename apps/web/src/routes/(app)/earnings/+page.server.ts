import type {
  Paginated,
  RewardStatus,
  RewardTransactionRecord,
  RewardTransactionType,
} from '@gemone/contracts';

import type { StatementResult } from '$lib/components/earnings';
import { LEDGER_STATUSES, LEDGER_TYPES } from '$lib/rewards/ledger';
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
 * ## Two filters, both on the API
 *
 * `type` is what a movement *was*; `status` is where its points are *now*
 * (TODO T80). Both are forwarded to `GET /rewards/history` and neither is
 * applied here — a filter applied after the fetch would page through twenty
 * rows, show four, and print "1–20 of 28" above them. Because the API filters
 * and counts with the same `where`, `total` is the filtered total and the
 * pager is right.
 *
 * They combine, and an impossible pair such as a paid withdrawal that is still
 * pending returns nothing. That is the correct answer, and the panel already
 * has a state that says so.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const type = readType(url.searchParams.get('type'));
  const status = readStatus(url.searchParams.get('status'));
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (type) query.set('type', type);
  if (status) query.set('status', status);
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
    status,
    offset,
    pageSize: PAGE_SIZE,
    /**
     * What the pager must preserve — the *sanitised* filters, not `url.search`.
     *
     * `?status=nonsense` is dropped by `readStatus`, and a pager that copied
     * the raw query string would carry it onto page two, where it would be
     * dropped again. Rebuilding from what was actually applied means the
     * links always describe the page they lead to.
     */
    query: pageQuery({ type, status }),
    now: nowIso(),
  };
};

/** The page's own parameters, as the pager and the filter form should carry them. */
function pageQuery(filters: { type: string; status: string }): string {
  const params = new URLSearchParams();

  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Only a type the UI knows about survives.
 *
 * `?type=DROP+TABLE` reaching the API would be answered with a 422 and turn
 * into the statement's error state — a filter nobody chose, failing a page
 * that works. `LEDGER_TYPES` is the same list the filter renders, so it cannot
 * drift from what the dropdown offers.
 */
function readType(raw: string | null): RewardTransactionType | '' {
  if (!raw) return '';

  return LEDGER_TYPES.includes(raw as RewardTransactionType) ? (raw as RewardTransactionType) : '';
}

/**
 * The same treatment for the status, and for the same reason.
 *
 * The API validates it too — `RewardHistoryDto` answers an unknown status with
 * a 422 naming the allowed ones — and that is the control. This is about what
 * a *user* sees: a mistyped or stale URL should show them their statement, not
 * an error panel about a parameter they did not type.
 */
function readStatus(raw: string | null): RewardStatus | '' {
  if (!raw) return '';

  return LEDGER_STATUSES.includes(raw as RewardStatus) ? (raw as RewardStatus) : '';
}

/** An unparseable offset is page one, not `NaN` rows into the ledger. */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export const __testing = { readType, readStatus, readOffset, pageQuery };
