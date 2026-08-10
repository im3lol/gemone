import { fail, redirect } from '@sveltejs/kit';

import { establishSession } from '$lib/server/api';
import type { Actions } from './$types';

export const actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const result = await establishSession(
      cookies,
      '/auth/register',
      { email, password },
      getClientAddress(),
    );

    if (!result.ok) {
      return fail(result.failure.status, { message: result.failure.message, email });
    }

    // Registering logs you in — the API issues a session with the account, and
    // sending someone to a login form to retype what they just typed is
    // friction with no security benefit.
    redirect(303, '/dashboard');
  },
} satisfies Actions;
