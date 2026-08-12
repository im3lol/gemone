import { fail, redirect } from '@sveltejs/kit';
import { CONFIG_SCOPES, ERROR_CODES } from '@gemone/contracts';
import type {
  AdminConfigurationKeyDetail,
  ConfigScopeName,
  ProviderSummary,
} from '@gemone/contracts';

import { isSettableAt, parseValue, versionFromField } from '$lib/admin/settings';
import { apiAuthed, apiAuthedJson, apiPath, readFailure, type ApiFailure } from '$lib/server/api';
import { failedDetailLoad } from '$lib/server/detail';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * What a bad key is told — TODO T86.
 *
 * A key is not a UUID, so there is no malformed *shape* the API rejects
 * separately: an unregistered key is a 404 either way, which is by design —
 * "a value cannot be written for an unregistered key". Both sentences point at
 * the same recovery, and the key is quoted back so a typo is visible.
 */
const NOT_FOUND = {
  malformed: 'That is not a setting this build registers.',
  missing: 'That is not a setting this build registers.',
};

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
 * ## Editing one provider's value — TODO T87, resolved
 *
 * `?scopeId=<provider>` switches this page to that provider's override: the
 * form writes at `PROVIDER` scope, the reset removes that provider's row, and
 * the precondition asserts that row's version rather than the global one.
 * Without the parameter it is the global value, as before.
 *
 * The scope lives in the **URL** rather than in a control's state, so "the hold
 * period for this provider" is a link, the Back button leaves the scope, and a
 * reload cannot land an operator on a different scope from the one they were
 * reading. Every guard for this is the API's and was already there: a key that
 * does not declare `PROVIDER` is refused, a missing or unknown provider is
 * refused, and a `scopeId` on a global write is refused.
 *
 * The provider list is fetched only for keys that declare the scope — there is
 * nothing to choose between otherwise — and a failure degrades to the global
 * editor rather than taking the page down.
 *
 * ## Authorization
 *
 * The same as everywhere under `/admin`: the layout avoids rendering a doomed
 * page, `@Roles(ADMIN)` on the controller is the control.
 */
export const load: PageServerLoad = async (event) => {
  const { params, url } = event;

  const scopeId = readScopeId(url.searchParams.get('scopeId'));

  /*
   * `scopeId` also asks the API to resolve the value *for* that provider, which
   * is the effective-value inspection §4.9 requires — the chain applied by the
   * thing that owns it rather than by a reader adding it up.
   */
  const detail = await apiAuthedJson<AdminConfigurationKeyDetail>(
    event,
    scopeId
      ? apiPath`/admin/configuration/${params.key}?scopeId=${scopeId}`
      : apiPath`/admin/configuration/${params.key}`,
  );

  if (!detail.ok) failedDetailLoad(detail.failure, NOT_FOUND);

  const setting = detail.value;
  const perProvider = isSettableAt(setting.scopes, CONFIG_SCOPES.PROVIDER);

  const providers = perProvider
    ? await apiAuthedJson<{ items: ProviderSummary[] }>(event, '/admin/providers')
    : null;

  /*
   * A scope the key does not declare is dropped rather than forwarded. The API
   * would refuse it with a 422, which on a *load* would take a working page to
   * an error screen over a query parameter somebody edited.
   */
  const scope: ConfigScopeName =
    scopeId && perProvider ? CONFIG_SCOPES.PROVIDER : CONFIG_SCOPES.GLOBAL;

  return {
    setting,
    scope,
    scopeId: scope === CONFIG_SCOPES.PROVIDER ? scopeId : '',
    providers: providers?.ok ? providers.value.items : [],
    now: nowIso(),
  };
};

/**
 * A provider id, or nothing.
 *
 * Validated as a UUID here because the API's `scopeId` is `@IsUUID` and a
 * malformed one is a 422 — which on a load is a working page replaced by an
 * error screen over an edited query parameter. The value is only ever set from
 * a link on this page, so anything else is a typo, and falling back to the
 * global scope is the recoverable answer.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readScopeId(raw: string | null): string {
  return raw && UUID.test(raw) ? raw : '';
}

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
 * Which row the submission is about — TODO T87.
 *
 * Read from the form rather than from the URL so the scope that was **rendered**
 * is the scope that is written: the two are the same today, and a page that
 * derived it again at submit time would silently retarget a write if the query
 * string were ever changed between render and submit.
 *
 * `scopeId` is sent only at PROVIDER scope, because `assertScopeTargetExists`
 * refuses one on a global write — correctly, since a global row has nowhere to
 * put it.
 */
function scopeFrom(form: FormData): { scope: ConfigScopeName; scopeId?: string } {
  const scopeId = field(form, 'scopeId');

  return scopeId
    ? { scope: CONFIG_SCOPES.PROVIDER, scopeId }
    : { scope: CONFIG_SCOPES.GLOBAL };
}

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
      stale: isStale(result.failure),
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
      stale: isStale(failure),
      ...submitted,
    });
  }

  return { ok: true as const, action, message, stale: false as const, value: '', reason: '' };
}

/**
 * Whether the refusal was "somebody else changed this" — TODO T88.
 *
 * Read from the API's own code rather than from the status: 409 is the right
 * status and it is not exclusive to this, and matching on the message would
 * break the moment the sentence is reworded. The screen treats this one
 * differently because the recovery is different — every other refusal is fixed
 * by changing what was typed, and this one is fixed by looking at what is
 * there now.
 */
function isStale(failure: ApiFailure): boolean {
  return failure.code === ERROR_CODES.CONFIG_STALE_WRITE;
}

export const actions = {
  set: async (event) => {
    const form = await event.request.formData();
    const raw = field(form, 'value');
    const why = field(form, 'reason').trim();
    const valueType = field(form, 'valueType');
    const submitted = { value: raw, reason: why };

    /*
     * The version the operator was looking at — TODO T88.
     *
     * Carried in a hidden field rather than re-read here, which is the whole
     * point: re-reading would compare the API against itself and would agree
     * every time. What has to be asserted is what the *person* saw.
     */
    const expectedUpdatedAt = versionFromField(field(form, 'expectedUpdatedAt'));
    const target = scopeFrom(form);

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
      return fail(422, {
        ok: false as const,
        action: 'set' as const,
        message: parsed.message,
        stale: false,
        ...submitted,
      });
    }

    return call(
      event,
      'set',
      apiPath`/admin/configuration/${event.params.key}`,
      'PUT',
      { value: parsed.value, ...target, reason: why, expectedUpdatedAt },
      target.scope === CONFIG_SCOPES.PROVIDER
        ? 'The value is stored for this provider, and wins over the global one.'
        : 'The value is stored and in force platform-wide.',
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
    const expectedUpdatedAt = versionFromField(field(form, 'expectedUpdatedAt'));
    const target = scopeFrom(form);

    return call(
      event,
      'reset',
      apiPath`/admin/configuration/${event.params.key}/reset`,
      'POST',
      { ...target, reason: why, expectedUpdatedAt },
      target.scope === CONFIG_SCOPES.PROVIDER
        ? 'The override was removed. This provider follows the global value again.'
        : 'The stored value was removed. This key follows the code default again.',
      { value: '', reason: why },
    );
  },
} satisfies Actions;

export const __testing = { reason, isStale, readScopeId, scopeFrom };
