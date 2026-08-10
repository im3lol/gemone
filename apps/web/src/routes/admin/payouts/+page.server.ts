import { redirect } from '@sveltejs/kit';
import type { AdminPayoutSummary, Paginated } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  const status = url.searchParams.get('status') ?? 'PENDING_REVIEW';

  const result = await apiAuthedJson<Paginated<AdminPayoutSummary>>(
    event,
    `/admin/payouts?limit=50&status=${encodeURIComponent(status)}`,
  );

  if (!result.ok) redirect(303, '/login');

  return { page: result.value, status };
};
