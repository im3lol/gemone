import { fail, redirect } from '@sveltejs/kit';
import type { Balance, Paginated, PayoutSummary } from '@gemone/contracts';

import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const [balance, payouts] = await Promise.all([
    apiAuthedJson<Balance>(event, '/rewards/balance'),
    apiAuthedJson<Paginated<PayoutSummary>>(event, '/payouts?limit=25'),
  ]);

  if (!balance.ok || !payouts.ok) redirect(303, '/login');

  return { balance: balance.value, payouts: payouts.value };
};

export const actions = {
  default: async (event) => {
    const { request } = event;
    const form = await request.formData();

    const result = await apiAuthed(event, '/payouts', {
      method: 'POST',
      body: JSON.stringify({
        amountPoints: Number(form.get('amountPoints') ?? 0),
        method: String(form.get('method') ?? ''),
        destination: String(form.get('destination') ?? ''),
      }),
    });

    if (!result.ok) return fail(result.failure.status, { message: result.failure.message });

    if (!result.value.ok) {
      // The API owns the limits, the minimum, and how many requests a day are
      // allowed. Its message is what the user sees, so the rules live in one
      // place and an admin changing one changes what the form says.
      const failure = await readFailure(result.value);
      return fail(failure.status, { message: failure.message });
    }

    return { submitted: true };
  },
} satisfies Actions;
