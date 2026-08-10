import { redirect } from '@sveltejs/kit';
import type { Paginated, WallOffer } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 24;

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));

  // Coerced rather than trusted: `?offset=abc` reached the page as NaN and
  // rendered "NaN–NaN of 2" in the pager.
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
  if (offset > 0) params.set('offset', String(offset));

  // Passed through, not interpreted: the API owns which filters exist and what
  // they mean, and a second copy of that list here would be a second thing to
  // change.
  for (const key of ['search', 'category', 'sort'] as const) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }

  const result = await apiAuthedJson<Paginated<WallOffer>>(
    event,
    `/offers?${params.toString()}`,
  );

  if (!result.ok) redirect(303, '/login');

  return {
    page: result.value,
    filters: {
      search: url.searchParams.get('search') ?? '',
      category: url.searchParams.get('category') ?? '',
      sort: url.searchParams.get('sort') ?? '',
    },
    offset,
    pageSize: PAGE_SIZE,
  };
};
