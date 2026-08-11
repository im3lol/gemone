import { error, fail, redirect } from '@sveltejs/kit';
import type { ClickResponse, WallOffer } from '@gemone/contracts';

import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

/**
 * One offer, and the button that starts it.
 *
 * Legacy has no detail page — its cards link straight out to the network — and
 * the UI audit (§5.9) records this page as an improvement over legacy rather
 * than a copy of it. It exists because a click has to be **recorded before the
 * user leaves** (PROJECT.md §4.3), and because the requirements are worth
 * reading before committing twenty minutes to an offer.
 *
 * The offer is awaited rather than streamed: it *is* the page, and there is
 * nothing to render around it.
 */
export const load: PageServerLoad = async (event) => {
  const { params } = event;

  const offer = await apiAuthedJson<WallOffer>(event, `/offers/${params.id}`);

  if (!offer.ok) {
    if (offer.failure.status === 401) redirect(303, `/login?next=/offers/${params.id}`);

    /*
     * The API answers 404 for an offer that does not exist, one that was
     * withdrawn, and one whose provider is switched off — deliberately
     * indistinguishable, so the wall is not an oracle for which providers we
     * run. This page keeps that distinction closed.
     */
    error(offer.failure.status === 404 ? 404 : 502, offer.failure.message);
  }

  // The rate comes from `(app)/+layout.server.ts` (T83), so this page reads one
  // endpoint and no more.
  return { offer: offer.value };
};

/**
 * Records the click, then sends the user to the provider.
 *
 * **The redirect URL comes from the API**, which builds it in the offer's own
 * adapter from a template the wall contract never exposes — never assembled
 * here, and never from anything the browser sent. A user holding the template
 * could mint their own tracking links.
 *
 * The order is the one PROJECT.md §4.3 fixes: the click row is written first,
 * and if that write fails there is no redirect. A user sent to a provider with
 * no click behind them cannot be credited and cannot be helped.
 */
export const actions = {
  default: async (event) => {
    const { params } = event;

    const result = await apiAuthed(event, '/clicks', {
      method: 'POST',
      body: JSON.stringify({ offerId: params.id }),
    });

    if (!result.ok) {
      if (result.failure.status === 401) redirect(303, `/login?next=/offers/${params.id}`);
      return fail(result.failure.status, { message: result.failure.message });
    }

    if (!result.value.ok) {
      /*
       * The API owns every reason a click can be refused — an offer withdrawn
       * since the page loaded, the per-user or per-IP rate limit, a suspended
       * account — and its message is what the user sees. Restating any of them
       * here would be a second copy of a rule that lives somewhere else.
       */
      const failure = await readFailure(result.value);

      if (failure.status === 401) redirect(303, `/login?next=/offers/${params.id}`);
      return fail(failure.status, { message: failure.message });
    }

    const click = (await result.value.json()) as ClickResponse;

    redirect(303, click.redirectUrl);
  },
} satisfies Actions;
