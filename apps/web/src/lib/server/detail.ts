import { error, redirect } from '@sveltejs/kit';

import type { ApiFailure } from './api';

/**
 * What an admin detail page does with a failed load — TODO T86.
 *
 * These pages all have the same shape: one `GET /admin/<thing>/:id` that *is*
 * the page, so a failure has nowhere to be rendered and has to become a status.
 * `/admin/payouts/[id]` answered every non-404 with 502, which turned the API's
 * *"Validation failed (uuid is expected)"* — a statement about the URL — into a
 * bad-gateway page blaming the API. 502 is also the page an operator escalates,
 * so it is the wrong answer twice.
 *
 * ## The four categories, kept apart
 *
 * The temptation is a `catch` that returns 404 for everything, which would make
 * the symptom go away and lose the distinctions an operator needs:
 *
 * - **Unauthenticated** is a redirect to the login form, not an error page.
 *   The session ended; there is something to do about it.
 * - **Forbidden** is 403. A signed-in non-admin must not be told 404, because
 *   that would say "this does not exist" about something that does.
 * - **Not found** and **invalid identifier** are both 404 — a reference that
 *   cannot name a payout and one that names no payout are the same fact to the
 *   person reading the page — but they carry **different sentences**, because
 *   "check the reference you pasted" and "this request no longer exists" lead
 *   somewhere different.
 * - **Upstream failure** stays a 5xx. A genuinely broken API must not be
 *   disguised as a missing record, or an outage is invisible until somebody
 *   wonders why every reference stopped resolving.
 *
 * ## Why 422 means the identifier
 *
 * These loads send **no body and no query** — the id in the path is their only
 * input, and `createUuidPipe` is what rejects it. So a 422 here can only be
 * about the identifier. That reasoning does not hold for the *actions* on these
 * pages, which post a reason and a reference, and those keep showing the API's
 * own message beside the form rather than routing through here.
 */
export interface NotFoundCopy {
  /** Shown when the identifier could never name a resource. */
  malformed: string;
  /** Shown when it is well-formed and names nothing. */
  missing: string;
}

export function failedDetailLoad(failure: ApiFailure, copy: NotFoundCopy): never {
  /*
   * `if` rather than a `switch`: `redirect` and `error` throw, so every arm
   * would need a `break` the reader can see is unreachable — which is also
   * what the linter says about it.
   */
  if (failure.status === 401) redirect(303, '/login');

  /*
   * Deliberately not 404. Hiding an admin resource behind "not found" for a
   * signed-in non-admin is a pattern that makes sense for guessable public
   * resources; here it would only make an operator's own mistake harder to
   * diagnose, and the layout has already refused them by the time this runs.
   */
  if (failure.status === 403) error(403, 'Admins only');

  if (failure.status === 404) error(404, copy.missing);
  if (failure.status === 422) error(404, copy.malformed);

  /*
   * Anything the API could not answer, kept as an upstream failure.
   *
   * 503 travels through unchanged: `apiAuthed` returns it when the API could
   * not be reached at all, and "busy, try again" is both true and actionable in
   * a way that 502 is not. Everything else — a 5xx, or a 4xx this page has no
   * reading for, which means the contract moved — is 502: the request was
   * well-formed and the answer was not one this layer understands.
   */
  error(failure.status === 503 ? 503 : 502, failure.message);
}
