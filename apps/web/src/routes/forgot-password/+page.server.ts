import { apiPublic } from '$lib/server/api';
import type { Actions } from './$types';

/**
 * Asks for a reset link — ARCHITECTURE.md §8.3.
 *
 * **The page says the same thing whatever happened.** The API answers 204 for
 * an address with an account and for one without, precisely so this endpoint
 * cannot be used to ask whether somebody has an account here (D76). A page
 * that rendered "no such account" would hand back the answer the API just
 * refused to give.
 *
 * Even a failed call renders the same confirmation. A 503 shown only for
 * addresses that exist is the same oracle wearing a different status code.
 */
export const actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');

    try {
      await apiPublic('/auth/forgot-password', { email }, 'POST', getClientAddress());
    } catch {
      // Swallowed for the reason above. The API logs what actually happened.
    }

    return { sent: true };
  },
} satisfies Actions;
