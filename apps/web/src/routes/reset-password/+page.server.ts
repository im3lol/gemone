import { fail } from '@sveltejs/kit';

import { apiPublic, readFailure } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sets a new password from a reset token — ARCHITECTURE.md §8.2, §8.3.
 *
 * Unlike verification, nothing is spent on load: the token is carried into the
 * form and only used when a password is submitted with it. Spending it to
 * render a page would burn the link every time a mail client previewed it, and
 * leave the person who actually clicks with nothing.
 *
 * No session is issued on success — the API deliberately does not, and this
 * page sends the user to the login form instead (D76).
 */
export const load: PageServerLoad = ({ url }) => {
  return { token: url.searchParams.get('token') ?? '' };
};

export const actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');

    const response = await apiPublic(
      '/auth/reset-password',
      { token, password },
      'POST',
      getClientAddress(),
    );

    if (!response.ok) {
      const failure = await readFailure(response);
      return fail(failure.status, { message: failure.message, token });
    }

    return { done: true };
  },
} satisfies Actions;
