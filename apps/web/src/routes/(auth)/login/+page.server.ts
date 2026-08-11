import { fail, redirect } from '@sveltejs/kit';

import { establishSession } from '$lib/server/api';
import type { Actions } from './$types';

export const actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const result = await establishSession(
      cookies,
      '/auth/login',
      { email, password },
      getClientAddress(),
    );

    if (!result.ok) {
      /*
       * The API's message is shown as-is. It is written to be safe to show —
       * one code for "no such email" and "wrong password" (§8.3) — and
       * rewording it here would risk reintroducing the distinction the API
       * removed on purpose.
       */
      return fail(result.failure.status, { message: result.failure.message, email });
    }

    redirect(303, safeNext(url.searchParams.get('next')));
  },
} satisfies Actions;

/**
 * Only same-site paths are honoured.
 *
 * `?next=https://elsewhere.example` on a login form is an open redirect, and
 * an open redirect on the page where people type passwords is a phishing
 * primitive. Anything that is not a path starting with a single `/` goes to
 * the dashboard instead.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

export const __testing = { safeNext };
