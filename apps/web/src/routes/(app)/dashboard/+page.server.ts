import type { Paginated, RewardTransactionRecord } from '@gemone/contracts';

import type { ActivityResult } from '$lib/components/dashboard';
import { apiAuthedJson } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { PageServerLoad } from './$types';

/** Enough to see a pattern, few enough to read. The statement is `/earnings`. */
const RECENT = 5;

/**
 * The dashboard — DESIGN_SYSTEM.md §16.
 *
 * ## What this load does not do
 *
 * It does not fetch the profile or the balance. `(app)/+layout.server.ts`
 * already loads both for the shell's identity pill, and SvelteKit merges layout
 * data into `data`, so the page reads them for free. Before this phase the
 * dashboard fetched `/users/me` a second time on every navigation — TODO T74,
 * whose trigger was written as "the phase that redesigns `/dashboard`".
 *
 * ## Why the history is a promise
 *
 * Returned **unawaited**, so SvelteKit streams it: the shell, the balance cards
 * and the account panel render as soon as the layout's two calls are in, and
 * the activity list fills in when the ledger answers. Awaiting it here would
 * hold the entire page on the slowest of three calls to show a five-row list.
 *
 * That is also what gives the list a real loading state. Without streaming
 * there is nothing to be loading — the server would have finished before the
 * first byte, and "loading" would be a state the code could describe but never
 * enter.
 *
 * ## Why it resolves a result instead of rejecting
 *
 * A streamed promise that rejects takes the whole page to SvelteKit's error
 * screen, throwing away balances that loaded perfectly well. Worse, the
 * pre-redesign pages answered *any* failed call with `redirect(303, '/login')`
 * — a statement endpoint having a bad minute would sign someone out. Here the
 * failure is data: the card renders an error, the rest of the page stands.
 *
 * The session is still the layout's business. If `/users/me` fails there, the
 * redirect happens there, before this ever runs.
 */
export const load: PageServerLoad = async (event) => {
  const activity: Promise<ActivityResult> = apiAuthedJson<Paginated<RewardTransactionRecord>>(
    event,
    `/rewards/history?limit=${RECENT}`,
  ).then((result) => (result.ok ? { ok: true, items: result.value.items } : { ok: false }));

  return {
    activity,
    /*
     * One clock reading for every relative timestamp on the page.
     *
     * The list renders on the server and again when it hydrates. A formatter
     * reading its own clock would say "4 minutes ago" in the HTML and "5
     * minutes ago" a beat later in the browser — a mismatch on whichever rows
     * happen to straddle a boundary. Both renders read this.
     */
    now: nowIso(),
  };
};
