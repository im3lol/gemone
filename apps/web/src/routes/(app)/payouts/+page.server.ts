import { fail, redirect } from '@sveltejs/kit';
import type { Paginated, PayoutSummary } from '@gemone/contracts';

import type { PayoutHistoryResult, WithdrawFieldErrors } from '$lib/components/payouts';
import { apiAuthed, apiAuthedJson, readFailure, type ApiFailure } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

/** `GET /payouts` defaults to 25 and caps at 100. Three requests a day makes 25 plenty. */
const HISTORY_LIMIT = 25;

/**
 * The withdrawal screen — ARCHITECTURE.md §11, DESIGN_SYSTEM.md §12.
 *
 * ## What it does not load
 *
 * The balance. `(app)/+layout.server.ts` already has it for the topbar's pill,
 * and SvelteKit merges layout data into `data`. This was the second half of
 * TODO T74's duplicate fetch — `/dashboard` gave up its copy in phase 4 and
 * this page kept fetching `/rewards/balance` a second time on every load.
 *
 * The **options** — which methods exist, the minimum, the rate — come from
 * `(app)/+layout.server.ts`, which has loaded them for the whole group since
 * T83 put the same rate on the dashboard and the statement. This page fetched
 * them itself until then; one value fetched by four pages is the shape T74
 * spent three phases undoing.
 *
 * ## What it does load
 *
 * The **history**, streamed (D83), resolving a result rather than
 * rejecting. A rejected streamed promise takes the whole page to SvelteKit's
 * error screen, and a list endpoint having a bad minute is no reason to
 * withhold a working withdrawal form.
 *
 * Neither redirects on failure. The pre-redesign version answered *any* failed
 * call with `redirect(303, '/login')`, signing people out because a list came
 * back 503 — the same defect phase 5 removed from `/earnings`. The session is
 * the layout's business, and the hook's before that.
 */
export const load: PageServerLoad = (event) => {
  const history: Promise<PayoutHistoryResult> = apiAuthedJson<Paginated<PayoutSummary>>(
    event,
    `/payouts?limit=${HISTORY_LIMIT}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    history,
    now: nowIso(),
  };
};

export const actions = {
  /**
   * Submits the withdrawal, and hands back whatever the API said about it.
   *
   * **The rules are not re-implemented here.** The minimum, the maximum, the
   * enabled methods, the daily cap and the balance check all live in the
   * service that owns them, and this forwards their answer verbatim. A BFF
   * that re-checked any of them would be a second copy of a rule an admin
   * thinks they changed in one place — and it would be the copy with no tests
   * over real data (`$lib/server/api.ts`: "the proxy forwards; it does not
   * transform").
   *
   * What it does add is *where* to show the answer: an error about the amount
   * belongs on the amount field, not in a banner above a form the user now has
   * to re-read to find the problem.
   */
  default: async (event) => {
    const form = await event.request.formData();

    /*
     * Echoed back on failure so a no-JS submission does not return an empty
     * form. The enhanced path keeps its values client-side and never reads
     * these, but the page has to work without JavaScript, and re-typing a
     * wallet address because the amount was ten points short is the kind of
     * thing that makes people give up on a withdrawal.
     */
    const values = {
      amountPoints: String(form.get('amountPoints') ?? '').trim(),
      method: String(form.get('method') ?? '').trim(),
      destination: String(form.get('destination') ?? '').trim(),
    };

    const result = await apiAuthed(event, '/payouts', {
      method: 'POST',
      body: JSON.stringify({
        // `Number('')` is 0, which the API's own `@Min(1)` refuses with a
        // proper validation message. Refusing it here would say the same thing
        // in a second voice.
        amountPoints: Number(values.amountPoints),
        method: values.method,
        destination: values.destination,
      }),
    });

    if (!result.ok) {
      if (result.failure.status === 401) redirect(303, '/login?next=%2Fpayouts');

      return fail(result.failure.status, { ok: false as const, ...describe(result.failure), values });
    }

    if (!result.value.ok) {
      const failure = await readFailure(result.value);

      if (failure.status === 401) redirect(303, '/login?next=%2Fpayouts');

      return fail(failure.status, { ok: false as const, ...describe(failure), values });
    }

    const payout = (await result.value.json()) as PayoutSummary;

    /*
     * The request as the API recorded it, not as it was typed — the cash
     * value and the masked destination are the server's, so the confirmation
     * states what was actually stored rather than what was sent.
     */
    return { ok: true as const, payout };
  },
} satisfies Actions;

/** The three controls an error can be attached to. */
const FORM_FIELDS = ['amountPoints', 'method', 'destination'] as const;
type FormField = (typeof FORM_FIELDS)[number];

/**
 * Which control a domain error is about.
 *
 * The API answers validation failures with a `fields` array (§15.3), but a
 * *domain* refusal — the amount is outside the configured range, the method is
 * not enabled, the destination is unreadable — carries only a code. These are
 * the codes that are really about one control, so its message can be attached
 * to it with `aria-invalid` and `aria-describedby` instead of floating above
 * the form.
 *
 * Anything not listed stays a form-level message, which is the right default:
 * the daily cap and an insufficient balance are about the request as a whole,
 * and pinning them to a field would say the field is malformed when it is not.
 *
 * Written as string literals rather than imported from `ERROR_CODES`, for the
 * reason `$lib/rewards/ledger.ts` records — TODO T79.
 */
const FIELD_FOR_CODE: Record<string, FormField> = {
  PAYOUT_AMOUNT_OUT_OF_RANGE: 'amountPoints',
  PAYOUT_METHOD_UNSUPPORTED: 'method',
  PAYOUT_DESTINATION_INVALID: 'destination',
};

/**
 * Splits one API failure into what goes on the fields and what goes above them.
 *
 * A message shown in both places is the same sentence twice, and the second
 * copy trains people to ignore the region that matters.
 */
function describe(failure: ApiFailure): { message: string | null; fields: WithdrawFieldErrors } {
  const fields: WithdrawFieldErrors = {};

  for (const error of failure.fields ?? []) {
    if (isFormField(error.field)) fields[error.field] = error.message;
  }

  if (Object.keys(fields).length > 0) return { message: null, fields };

  const field = FIELD_FOR_CODE[failure.code];
  if (field) return { message: null, fields: { [field]: failure.message } };

  return { message: failure.message, fields: {} };
}

function isFormField(field: string): field is FormField {
  return (FORM_FIELDS as readonly string[]).includes(field);
}

export const __testing = { describe, FORM_FIELDS, HISTORY_LIMIT };
