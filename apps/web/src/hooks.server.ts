import { redirect, type Handle } from '@sveltejs/kit';

import { readSession } from '$lib/server/session';

/**
 * Route protection — PROJECT.md M1, ARCHITECTURE.md §6.1.
 *
 * **This is a redirect, not authorization.** The session cookie is only
 * evidence that this browser holds tokens; whether those tokens are still
 * valid, and what they are allowed to do, is decided by the API's guards on
 * every call (§6.2 steps 7–8). What happens here is a user-experience
 * decision: send someone who is not logged in to the login page instead of
 * rendering a page that will fail its own data load.
 *
 * Getting that distinction wrong is how a front end ends up being the thing
 * that decides who may see what.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/offers', '/earnings', '/payouts', '/admin'];

/**
 * Pages that a logged-in user has no use for.
 *
 * Only login and registration. Not the reset flow — someone who is logged in
 * on this browser and clicks a reset link in their mail has a good reason to
 * be there, and bouncing them to the dashboard would strand a link that works.
 */
const GUEST_ONLY_PATHS = ['/login', '/register'];

export const handle: Handle = async ({ event, resolve }) => {
  const session = readSession(event.cookies);
  event.locals.session = session;

  const path = event.url.pathname;

  if (!session && PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    // Where they were going, so the login form can send them back there.
    const next = encodeURIComponent(path + event.url.search);
    redirect(303, `/login?next=${next}`);
  }

  if (session && GUEST_ONLY_PATHS.includes(path)) {
    redirect(303, '/dashboard');
  }

  return resolve(event);
};
