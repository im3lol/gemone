import { redirect } from '@sveltejs/kit';
import type { UserProfile } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { PageServerLoad } from './$types';

/**
 * The empty dashboard M1 demos — PROJECT.md §7.
 *
 * Empty is the point: there is nothing to show yet because balances arrive in
 * M3 and the offer wall in M2. What it does prove is the whole chain — cookie
 * read, bearer minted, API guard passed, profile returned — which is the part
 * that has to work before anything can be put on this page.
 */
export const load: PageServerLoad = async (event) => {
  const result = await apiAuthedJson<UserProfile>(event, '/users/me');

  if (!result.ok) {
    // 401 here means the refresh already failed inside the client and the
    // cookie has been cleared. Anything else is the API being unwell, and a
    // login page is a better answer than a stack of error text.
    redirect(303, '/login');
  }

  return { profile: result.value };
};
