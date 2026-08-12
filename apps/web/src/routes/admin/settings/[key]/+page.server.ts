import { error, fail, redirect } from '@sveltejs/kit';
import { CONFIG_SCOPES } from '@gemone/contracts';
import type { AdminConfigurationKeyDetail } from '@gemone/contracts';

import { parseValue } from '$lib/admin/settings';
import { apiAuthed, apiAuthedJson, readFailure, type ApiFailure } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * One setting — ARCHITECTURE.md §4.9.
 *
 * `GET /admin/configuration/:key` returns the key's definition, every explicit
 * setting at every scope, and its timeline. All three are on the page because
 * they answer the three questions an operator has in order: what is this, what
 * is stored, and who changed it last.
 *
 * Awaited rather than streamed: the key *is* the page, and there is no frame
 * worth painting around a value that is not there yet.
 *
 * ## This screen writes at GLOBAL scope only
 *
 * `PUT /admin/configuration/:key` accepts `scope: PROVIDER` with a `scopeId`,
 * and eleven of the thirty keys declare that scope. A per-provider editor is a
 * genuinely different screen — it needs a provider picker, and the value it
 * shows depends on which provider is selected — and building a half of one
 * here would let an operator set a provider override without ever seeing the
 * other providers' values. The existing overrides are **shown**, with which
 * provider each belongs to, so nothing is hidden. Recorded as TODO T87.
 *
 * ## Authorization
 *
 * The same as everywhere under `/admin`: the layout avoids rendering a doomed
 * page, `@Roles(ADMIN)` on the controller is the control.
 */
export const load: PageServerLoad = async (event) => {
  const { params } = event;

  const detail = await apiAuthedJson<AdminConfigurationKeyDetail>(
    event,
    `/admin/configuration/${encodeURIComponent(params.key)}`,
  );

  if (!detail.ok) {
    if (detail.failure.status === 401) redirect(303, '/login');
    if (detail.failure.status === 403) error(403, 'Admins only');

    /*
     * A 4xx is a statement about the request, and the only thing in this
     * request is the key. An unregistered key is a 404 by design — "a value
     * cannot be written for an unregistered key" — and reporting that as 502
     * would blame the API for a URL somebody mistyped.
     */
    error(detail.failure.status < 500 ? 404 : 502, detail.failure.message);
  }

  return { setting: detail.value, now: nowIso() };
};

/**
 * The most specific thing the API said.
 *
 * A key's Zod schema is the authority on what a value may be, and its message
 * is what an operator needs — *"Number must be less than or equal to 180"* is
 * the hold period's actual rule, and it arrives from the one place that rule is
 * written. The envelope's "Validation failed" says only that something was
 * wrong.
 */
function reason(failure: ApiFailure): string {
  const fields = failure.fields ?? [];
  if (fields.length === 0) return failure.message;

  return fields.map((field) => `${field.field}: ${field.message}`).join('; ');
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '');

/**
 * Two actions, because the API has two: set a value, and remove the stored one.
 *
 * Both take a mandatory reason of at least three characters, and neither rule
 * is restated here. What the value may *be* is the key's registered schema,
 * which this layer could not check without holding a copy of thirty schemas.
 *
 * **Every failure carries the submitted value back.** A settings form that
 * clears itself on a refusal makes the operator retype a JSON array to find out
 * what was wrong with it the second time.
 */
async function call(
  event: RequestEvent,
  action: 'set' | 'reset',
  path: string,
  method: 'POST' | 'PUT',
  body: unknown,
  message: string,
  submitted: { value: string; reason: string },
) {
  const result = await apiAuthed(event, path, { method, body: JSON.stringify(body) });

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    return fail(result.failure.status, {
      ok: false as const,
      action,
      message: reason(result.failure),
      ...submitted,
    });
  }

  if (!result.value.ok) {
    const failure = await readFailure(result.value);

    if (failure.status === 401) redirect(303, '/login');
    return fail(failure.status, {
      ok: false as const,
      action,
      message: reason(failure),
      ...submitted,
    });
  }

  return { ok: true as const, action, message, value: '', reason: '' };
}

export const actions = {
  set: async (event) => {
    const form = await event.request.formData();
    const raw = field(form, 'value');
    const why = field(form, 'reason').trim();
    const valueType = field(form, 'valueType');
    const submitted = { value: raw, reason: why };

    /*
     * The one check made here rather than at the API.
     *
     * Unparseable JSON is not a value of any type, so there is nothing to send:
     * the schema would answer with an error about a string, which describes the
     * symptom rather than the mistake. Syntax is also the one thing a browser
     * can be certain about without knowing the key's rule.
     */
    const parsed = parseValue(raw, valueType);

    if (!parsed.ok) {
      return fail(422, { ok: false as const, action: 'set' as const, message: parsed.message, ...submitted });
    }

    return call(
      event,
      'set',
      `/admin/configuration/${encodeURIComponent(event.params.key)}`,
      'PUT',
      { value: parsed.value, scope: CONFIG_SCOPES.GLOBAL, reason: why },
      'The value is stored and in force platform-wide.',
      submitted,
    );
  },

  /**
   * Removes the stored value, returning the key to its resolution chain.
   *
   * Not "set it back to the default": those differ, and §4.9 turns on the
   * difference. A reset leaves nothing stored, so the key follows code again
   * and a release can move it. Writing the default explicitly would freeze
   * today's default as a decision nobody made.
   */
  reset: async (event) => {
    const form = await event.request.formData();
    const why = field(form, 'reason').trim();

    return call(
      event,
      'reset',
      `/admin/configuration/${encodeURIComponent(event.params.key)}/reset`,
      'POST',
      { scope: CONFIG_SCOPES.GLOBAL, reason: why },
      'The stored value was removed. This key follows the code default again.',
      { value: '', reason: why },
    );
  },
} satisfies Actions;

export const __testing = { reason };
