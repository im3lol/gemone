import { fail, redirect } from '@sveltejs/kit';
import { FRAUD_REVIEW_DECISIONS } from '@gemone/contracts';
import type { AdminHeldConversionSummary, Paginated } from '@gemone/contracts';

import type { HeldQueueResult } from '$lib/components/admin';
import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** `GET /admin/fraud/held` caps `limit` at 100. Ten cards is a screenful. */
const PAGE_SIZE = 10;

/**
 * Fraud review — PROJECT.md §4.7, ARCHITECTURE.md §4.2.
 *
 * *"Scores are advisory: high-risk conversions are credited but **held** (not
 * withdrawable) pending admin review, rather than rejected outright."* This
 * page is where that review happens. It is the last open link in the loop the
 * product already had end to end everywhere else: a conversion is scored, held,
 * decided, and the points either mature or go back.
 *
 * ## No fraud logic here, and none in the components
 *
 * The engine scored; `resolveHold` decides what each decision does to the
 * points and refuses one on a conversion that is not held; `AdminFraudService`
 * writes the audit entry in the same transaction as the money movement. This
 * layer supplies a form and shows what came back. `$lib/admin/fraud.ts` holds
 * the vocabulary, which is the only part a browser can honestly own.
 *
 * ## Streaming, and why the promise resolves instead of rejecting
 *
 * D83. The header paints while the queue call is open, and a failure resolves
 * `{ ok: false }` rather than rejecting — a rejected streamed promise takes the
 * whole page to SvelteKit's error screen.
 *
 * ## Authorization
 *
 * `admin/+layout.server.ts` refuses a non-admin, and `AdminFraudController`
 * carries `@Roles(ADMIN)` regardless. The layout check only avoids rendering a
 * page whose every request will fail; the API is the control.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const userId = readUserId(url.searchParams.get('userId'));
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (userId) query.set('userId', userId);
  if (offset > 0) query.set('offset', String(offset));

  const queue: Promise<HeldQueueResult> = apiAuthedJson<Paginated<AdminHeldConversionSummary>>(
    event,
    `/admin/fraud/held?${query}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    queue,
    userId,
    offset,
    pageSize: PAGE_SIZE,
    /** Rebuilt from what was applied, so the pager cannot carry a value that was dropped. */
    query: userId ? `?userId=${userId}` : '',
    now: nowIso(),
  };
};

/**
 * A UUID, or nothing.
 *
 * `AdminListHeldConversionsDto` accepts any string of 36 characters or fewer,
 * and a non-UUID reaching the query is a database error rather than an empty
 * result — a 500 on an admin queue because somebody edited the address bar.
 * The filter is only ever set from a link on this page, so anything else is a
 * typo and showing the whole queue is the recoverable answer.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUserId(raw: string | null): string {
  return raw && UUID.test(raw) ? raw : '';
}

/** An unparseable offset is page one, not `NaN` rows into the queue. */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

/**
 * One action per decision, named after the decision it posts.
 *
 * `?/clear` → `{ decision: 'CLEAR' }`, `?/confirm` → `{ decision: 'CONFIRM' }`.
 * One name for one edge, all the way through, so there is no table anywhere
 * mapping a button to a meaning.
 *
 * **Nothing here validates the reason or the state.** The reason is mandatory
 * in `ReviewHeldConversionDto` and a conversion that is no longer held is
 * refused by `resolveHold` with a 409 under a row lock — which is what makes
 * two admins deciding the same hold in the same second safe. A copy of either
 * rule in the BFF would be a second place to change it, and the copy with no
 * tests over real data.
 */
async function decide(event: RequestEvent, action: 'clear' | 'confirm') {
  const form = await event.request.formData();
  const conversionId = String(form.get('conversionId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  const decision =
    action === 'clear' ? FRAUD_REVIEW_DECISIONS.CLEAR : FRAUD_REVIEW_DECISIONS.CONFIRM;

  const result = await apiAuthed(event, `/admin/fraud/held/${conversionId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    return fail(result.failure.status, {
      ok: false as const,
      action,
      conversionId,
      message: result.failure.message,
    });
  }

  if (!result.value.ok) {
    const failure = await readFailure(result.value);

    if (failure.status === 401) redirect(303, '/login');
    return fail(failure.status, {
      ok: false as const,
      action,
      conversionId,
      message: failure.message,
    });
  }

  const held = (await result.value.json()) as AdminHeldConversionSummary;

  return {
    ok: true as const,
    action,
    conversionId,
    message:
      action === 'clear'
        ? `${held.rewardPoints.toLocaleString('en-US')} points were cleared and will mature.`
        : `${held.rewardPoints.toLocaleString('en-US')} points were reversed and left the balance.`,
  };
}

export const actions = {
  clear: (event) => decide(event, 'clear'),
  confirm: (event) => decide(event, 'confirm'),
} satisfies Actions;

export const __testing = { readUserId, readOffset, PAGE_SIZE };
