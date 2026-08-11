import { redirect } from '@sveltejs/kit';
import type { Balance, UserProfile } from '@gemone/contracts';

import { apiAuthedJson } from '$lib/server/api';
import type { LayoutServerLoad } from './$types';

/**
 * What the application shell needs — DESIGN_SYSTEM.md §14.3.
 *
 * Scoped to the `(app)` group rather than the root layout, which is the whole
 * reason the group exists. The old root layout deliberately loaded nothing but
 * a boolean, because a profile fetch there would have run on the login page and
 * the password-reset page too. Here it runs only where there is a shell to
 * fill.
 *
 * ## Why the balance is allowed to fail
 *
 * A missing profile means the session is finished, and the redirect matches
 * what every page load in this app already does. A missing **balance** means
 * one endpoint is unwell — and logging someone out of their earnings page
 * because a number could not be fetched would be a worse answer than a topbar
 * with no number in it. The pill hides the figure rather than showing a zero,
 * because a zero balance and an unknown balance are not the same claim.
 *
 * ## The duplicate fetch, half of it now gone
 *
 * Phase 2 left this layout fetching `/users/me` and `/rewards/balance` while
 * `/dashboard` fetched the profile again and `/payouts` fetched the balance
 * again — recorded as TODO T74, whose stated trigger was "the phase that
 * redesigns `/dashboard`". This is that phase.
 *
 * The whole `Balance` is returned rather than the one figure the topbar reads,
 * so `/dashboard`, `/earnings` and `/payouts` all render their buckets from
 * what the shell already loaded. Phase 6 folded in the last of them and T74 is
 * closed: no route in this group now calls an endpoint its parent has called.
 *
 * **`balance` is `Balance | null`, and the null is load-bearing.** A page that
 * reads it must decide what an unknown balance looks like, which is the same
 * decision the topbar makes: show nothing rather than show a zero. A zero
 * balance and an unfetchable balance are different claims about someone's
 * money.
 */
export const load: LayoutServerLoad = async (event) => {
  const [me, balance] = await Promise.all([
    apiAuthedJson<UserProfile>(event, '/users/me'),
    apiAuthedJson<Balance>(event, '/rewards/balance'),
  ]);

  if (!me.ok) redirect(303, '/login');

  return {
    profile: me.value,
    balance: balance.ok ? balance.value : null,
  };
};
