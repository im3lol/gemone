import type { PageServerLoad } from './$types';

/**
 * The landing page — DESIGN_SYSTEM.md §18, PROJECT.md §7 (M6).
 *
 * Until phase 3 this route was a signpost: `redirect(303, session ? /dashboard
 * : /login)`. That made the product's only public surface a login form, which
 * is what UI_AUDIT.md records as the largest gap between this app and the
 * design it was built from. `/` now renders the marketing page for everyone.
 *
 * **The session is read, not enforced.** A logged-in visitor still gets the
 * landing page — they may have arrived from a link, or want to read what the
 * product says about itself — and the header swaps its sign-up pair for a way
 * back into the app. Bouncing them to `/dashboard` would mean the public page
 * is unreachable to the people most likely to link to it.
 *
 * Only the boolean crosses the wire. Nothing on this page needs to know *who*
 * is logged in, and a public page is the last place to start shipping a
 * profile to the browser.
 */
export const load: PageServerLoad = ({ locals }) => {
  return { authenticated: Boolean(locals.session) };
};
