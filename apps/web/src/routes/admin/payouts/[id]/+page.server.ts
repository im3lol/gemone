import { error, fail, redirect } from '@sveltejs/kit';
import type { AdminPayoutDetail } from '@gemone/contracts';

import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params } = event;
  const result = await apiAuthedJson<AdminPayoutDetail>(
    event,
    `/admin/payouts/${params.id}`,
  );

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    error(result.failure.status === 404 ? 404 : 502, result.failure.message);
  }

  return { payout: result.value };
};

/**
 * One action per transition, because the API has one endpoint per transition
 * and the state machine lives there. This page posts and reports.
 */
async function transition(
  context: Parameters<typeof apiAuthed>[0],
  id: string,
  step: 'approve' | 'reject' | 'settle' | 'fail',
  body: unknown,
) {
  const result = await apiAuthed(context, `/admin/payouts/${id}/${step}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!result.ok) return fail(result.failure.status, { message: result.failure.message });

  if (!result.value.ok) {
    const failure = await readFailure(result.value);
    return fail(failure.status, { message: failure.message });
  }

  return { done: step };
}

export const actions = {
  approve: async (event) => {
    const form = await event.request.formData();
    return transition(event, event.params.id, 'approve', { reason: String(form.get('reason') ?? '') });
  },

  reject: async (event) => {
    const form = await event.request.formData();
    return transition(event, event.params.id, 'reject', { reason: String(form.get('reason') ?? '') });
  },

  settle: async (event) => {
    const form = await event.request.formData();
    return transition(event, event.params.id, 'settle', {
      externalReference: String(form.get('externalReference') ?? ''),
    });
  },
} satisfies Actions;
