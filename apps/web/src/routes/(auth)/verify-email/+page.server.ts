import { apiPublic, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

/**
 * Confirms an address — ARCHITECTURE.md §8.3.
 *
 * The token arrives in the query string when a link is followed, and by hand
 * otherwise: no email carries a link yet, because until this app existed there
 * was nowhere for one to point (TODO T67). The paste box is what makes the
 * flow completable in the meantime, and it costs a form.
 *
 * The token is spent in a `load`, which means following the link verifies the
 * address — no button to press. That is a GET with an effect, and it is the
 * right trade here: the token is single-use and consuming it is exactly what
 * the recipient asked for by clicking. A mail scanner following the link burns
 * it, which is why the API answers the second attempt with a clear error
 * rather than a crash (D75).
 */
export const load: PageServerLoad = async ({ url, getClientAddress }) => {
  const token = url.searchParams.get('token');
  if (!token) return { state: 'idle' as const };

  return { state: await verify(token, getClientAddress()) };
};

export const actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');

    return { state: await verify(token, getClientAddress()) };
  },
} satisfies Actions;

async function verify(token: string, clientAddress: string): Promise<'verified' | 'failed'> {
  const response = await apiPublic('/auth/verify-email', { token }, 'POST', clientAddress);

  if (response.ok) return 'verified';

  // The body is read so the response is not left undrained, and because a
  // failure worth logging is a failure worth having parsed.
  await readFailure(response);

  return 'failed';
}
