import { redirect } from '@sveltejs/kit';
import type { Balance, Paginated, RewardTransactionRecord } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  // Same coercion as the offer wall: an unparseable offset rendered as NaN.
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));

  const [balance, history] = await Promise.all([
    apiAuthedJson<Balance>(event, '/rewards/balance'),
    apiAuthedJson<Paginated<RewardTransactionRecord>>(
      event,
      `/rewards/history?limit=${PAGE_SIZE}${offset > 0 ? `&offset=${offset}` : ''}`,
    ),
  ]);

  if (!balance.ok || !history.ok) redirect(303, '/login');

  return { balance: balance.value, history: history.value, offset, pageSize: PAGE_SIZE };
};
