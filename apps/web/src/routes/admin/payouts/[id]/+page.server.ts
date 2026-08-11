import { error, fail, redirect } from '@sveltejs/kit';
import type { AdminPayoutDetail, AdminPayoutSummary } from '@gemone/contracts';

import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * One request, in full — ARCHITECTURE.md §11.3, DATABASE.md §3.5.
 *
 * **Loading this page writes an audit entry.** `GET /admin/payouts/:id` is the
 * only view that returns a payment destination, and §3.5 requires that view to
 * be audited: "who looked at this user's bank details, and when" is a question
 * asked after the details turn up somewhere they should not have. The entry is
 * written by the API, not here — it belongs in the same transaction as the
 * read, and this layer only forwards.
 *
 * It is awaited rather than streamed. It *is* the page, and there is nothing
 * to render around it.
 */
export const load: PageServerLoad = async (event) => {
  const { params } = event;

  const result = await apiAuthedJson<AdminPayoutDetail>(event, `/admin/payouts/${params.id}`);

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    if (result.failure.status === 403) error(403, 'Admins only');

    error(result.failure.status === 404 ? 404 : 502, result.failure.message);
  }

  return { payout: result.value };
};

/**
 * One action per transition, because the API has one endpoint per transition
 * and the state machine lives there. This page posts and reports.
 *
 * **Nothing here decides whether a transition is allowed.** `assertTransition`
 * does, under a `SELECT … FOR UPDATE` on the request row, inside the
 * transaction that moves the money — which is what makes two admins clicking
 * Approve in the same second safe. A refusal comes back as a 409 with a
 * readable message and is shown as it is.
 *
 * Reasons are not validated here either. A rejection needs one and an approval
 * does not, and that rule lives in `applyTransition`; a copy of it in the BFF
 * would be a second place to change when it moves, and the copy with no tests
 * over real data.
 */
async function transition(
  event: RequestEvent,
  step: 'approve' | 'reject' | 'settle' | 'fail',
  body: unknown,
) {
  const result = await apiAuthed(event, `/admin/payouts/${event.params.id}/${step}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    return fail(result.failure.status, {
      ok: false as const,
      action: step,
      message: result.failure.message,
    });
  }

  if (!result.value.ok) {
    const failure = await readFailure(result.value);

    if (failure.status === 401) redirect(303, '/login');
    return fail(failure.status, { ok: false as const, action: step, message: failure.message });
  }

  const payout = (await result.value.json()) as AdminPayoutSummary;

  // The status the server recorded, not the one this action asked for — a
  // confirmation that restates the request rather than the result is a
  // confirmation that can be wrong.
  return { ok: true as const, action: step, status: payout.status };
}

const reasonFrom = async (event: RequestEvent) =>
  String((await event.request.formData()).get('reason') ?? '').trim();

export const actions = {
  approve: async (event) => transition(event, 'approve', { reason: await reasonFrom(event) }),

  reject: async (event) => transition(event, 'reject', { reason: await reasonFrom(event) }),

  fail: async (event) => transition(event, 'fail', { reason: await reasonFrom(event) }),

  settle: async (event) => {
    const form = await event.request.formData();

    return transition(event, 'settle', {
      externalReference: String(form.get('externalReference') ?? '').trim(),
    });
  },
} satisfies Actions;
