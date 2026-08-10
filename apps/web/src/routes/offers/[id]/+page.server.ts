import { error, fail, redirect } from '@sveltejs/kit';
import type { ClickResponse, WallOffer } from '@gemone/contracts';

import { apiAuthed, apiAuthedJson, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params } = event;
  const result = await apiAuthedJson<WallOffer>(event, `/offers/${params.id}`);

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    error(result.failure.status === 404 ? 404 : 502, result.failure.message);
  }

  return { offer: result.value };
};

/**
 * Records the click, then sends the user to the provider.
 *
 * The redirect URL comes from the API, which builds it in the offer's adapter
 * — never assembled here from anything the browser sent.
 */
export const actions = {
  default: async (event) => {
    const { params } = event;
    const result = await apiAuthed(event, '/clicks', {
      method: 'POST',
      body: JSON.stringify({ offerId: params.id }),
    });

    if (!result.ok) return fail(result.failure.status, { message: result.failure.message });

    if (!result.value.ok) {
      const failure = await readFailure(result.value);
      return fail(failure.status, { message: failure.message });
    }

    const click = (await result.value.json()) as ClickResponse;

    redirect(303, click.redirectUrl);
  },
} satisfies Actions;
