import { error, redirect } from '@sveltejs/kit';
import type { UserProfile } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { LayoutServerLoad } from './$types';

/**
 * Keeps non-admins out of the admin screens.
 *
 * Like the rest of `web`, this is a redirect and not authorization: every
 * `/admin/*` API route carries `@Roles(ADMIN)`, so a user who reached these
 * pages would get 403s from the API regardless. This only avoids rendering a
 * page whose every request will fail.
 */
export const load: LayoutServerLoad = async (event) => {
  const me = await apiAuthedJson<UserProfile>(event, '/users/me');

  if (!me.ok) redirect(303, '/login');
  if (me.value.role !== 'ADMIN') error(403, 'Admins only');

  return { admin: me.value };
};
