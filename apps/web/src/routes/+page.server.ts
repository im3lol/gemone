import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

/**
 * The root is a signpost, not a page.
 *
 * A marketing landing page is M6's problem (PROJECT.md §7); until there is
 * one, sending people where they were going is more useful than an empty
 * index.
 */
export const load: PageServerLoad = ({ locals }) => {
  redirect(303, locals.session ? '/dashboard' : '/login');
};
