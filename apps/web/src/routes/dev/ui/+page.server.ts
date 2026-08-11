import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

/**
 * The UI kit showcase — docs/UI_KIT.md.
 *
 * ## Why it exists
 *
 * Components with five variants, six states and four breakpoints cannot be
 * verified by reading them. This page renders every one of them on a single
 * screen, which is how the focus rings, disabled states and mobile overflow in
 * this phase were actually checked — and how the next phase's changes get
 * checked against them.
 *
 * ## Why it is not reachable in production
 *
 * `dev` is a build-time constant, so this `error(404)` is not a runtime
 * permission check that could be misconfigured: in a production build the
 * branch is the only one left. The page is not an admin surface and has no
 * auth of its own, so "not present" is the correct posture rather than
 * "present but protected".
 */
export const load: PageServerLoad = () => {
  if (!dev) error(404, 'Not found');
  return {};
};
