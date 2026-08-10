import type { LayoutServerLoad } from './$types';

/**
 * What the shell needs, and nothing more.
 *
 * Deliberately not the user's profile: that would be an API call on every
 * page, including the public ones, to render a name in a header. The pages
 * that need the profile load it themselves.
 */
export const load: LayoutServerLoad = ({ locals }) => {
  return { isAuthenticated: locals.session !== null };
};
