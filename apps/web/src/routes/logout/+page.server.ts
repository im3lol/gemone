import { redirect } from '@sveltejs/kit';

import { endSession } from '$lib/server/api';
import type { Actions } from './$types';

/**
 * POST only, deliberately.
 *
 * A logout reachable by GET is a logout any image tag on any page can trigger.
 * The form in the layout posts here.
 */
export const actions = {
  default: async (event) => {
    await endSession(event);
    redirect(303, '/login');
  },
} satisfies Actions;
