import type { AdminPayoutSummary, Paginated, PayoutStatus } from '@gemone/contracts';

import type { QueueResult } from '$lib/components/admin';
import { PAYOUT_STATUSES_IN_QUEUE_ORDER } from '$lib/admin/payout-queue';
import { apiAuthedJson } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { PageServerLoad } from './$types';

/** `GET /admin/payouts` caps `limit` at 100. Twenty-five is a screenful of queue. */
const PAGE_SIZE = 25;

/**
 * The payout queue — ARCHITECTURE.md §11.3.
 *
 * ## Streaming, and why the promise resolves instead of rejecting
 *
 * D83. The tabs and the header paint while the queue call is open, and a
 * failure resolves `{ ok: false }` rather than rejecting. The version this
 * replaces answered any failed call with `redirect(303, '/login')` — on an
 * admin screen that means a queue endpoint having a bad minute logs the
 * administrator out of the tool they were investigating with.
 *
 * ## Authorization is not here
 *
 * `admin/+layout.server.ts` refuses a non-admin, and every `/admin/*` endpoint
 * carries `@Roles(ADMIN)` regardless — so a user who somehow reached this page
 * would get 403s from the API. The layout check only avoids rendering a page
 * whose every request will fail; it is not the control.
 *
 * ## The default tab
 *
 * `PENDING_REVIEW`, because that is the queue — the API even orders it oldest
 * first for that status alone, so it is worked in the order people joined it.
 * An explicit `?status=` overrides it, and `?status=` (empty) means all.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const status = readStatus(url.searchParams);
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (status) query.set('status', status);
  if (offset > 0) query.set('offset', String(offset));

  const queue: Promise<QueueResult> = apiAuthedJson<Paginated<AdminPayoutSummary>>(
    event,
    `/admin/payouts?${query}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    queue,
    status,
    offset,
    pageSize: PAGE_SIZE,
    query: url.search,
    now: nowIso(),
  };
};

/**
 * Which tab, defaulting to the queue rather than to everything.
 *
 * A **present but empty** `?status=` is "all" and a missing one is
 * `PENDING_REVIEW` — the difference is what lets the All tab be a link the
 * Back button can return from. An unrecognised value falls back to the
 * default: the API answers an unknown enum with a 422, which would turn the
 * whole queue into an error state over a URL somebody mistyped.
 */
function readStatus(params: URLSearchParams): PayoutStatus | '' {
  const raw = params.get('status');

  if (raw === null) return 'PENDING_REVIEW';
  if (raw === '') return '';

  return PAYOUT_STATUSES_IN_QUEUE_ORDER.includes(raw as PayoutStatus)
    ? (raw as PayoutStatus)
    : 'PENDING_REVIEW';
}

/** An unparseable offset is page one, not `NaN` rows into the queue. */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export const __testing = { readStatus, readOffset, PAGE_SIZE };
