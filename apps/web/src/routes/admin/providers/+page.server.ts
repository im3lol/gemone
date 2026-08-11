import { fail, redirect } from '@sveltejs/kit';
import type {
  Paginated,
  ProviderCapabilityReport,
  ProviderSummary,
  SyncRunSummary,
} from '@gemone/contracts';

import type { ProviderResult } from '$lib/components/admin';
import { apiAuthed, apiAuthedJson, readFailure, type ApiFailure } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * Enough runs to find the latest for every provider in one call — see the note
 * on `latestRunPerProvider`.
 */
const SYNC_RUN_WINDOW = 50;

/**
 * Provider management — ARCHITECTURE.md §7.
 *
 * The screen that takes the operator's first job out of a terminal. Every
 * phase before this registered the mock provider, enabled it and triggered its
 * catalog sync with hand-written API calls; those three are the whole of
 * "connect a provider", and they are what this page does.
 *
 * ## What it loads, and why the latest run costs one call and not N
 *
 * `GET /admin/catalog/sync-runs` returns runs newest-first across every
 * provider. One call for a window of them, reduced to a map of provider id →
 * first occurrence, is the latest run for each — with no `providerId` filter
 * and therefore no request per provider. A provider whose last run fell
 * outside the window shows as never-synced, which is the honest reading of
 * "nothing recent".
 *
 * The **adapters** are awaited: they decide whether the registration form can
 * exist at all, and a form that appeared a beat later would be a form that
 * appeared to be missing.
 *
 * ## Authorization
 *
 * `admin/+layout.server.ts` refuses a non-admin, and every `/admin/*` endpoint
 * carries `@Roles(ADMIN)` regardless. The layout check only avoids rendering a
 * page whose every request will fail; the API is the control.
 */
export const load: PageServerLoad = async (event) => {
  const providers: Promise<ProviderResult> = Promise.all([
    apiAuthedJson<{ items: ProviderSummary[] }>(event, '/admin/providers'),
    apiAuthedJson<Paginated<SyncRunSummary>>(
      event,
      `/admin/catalog/sync-runs?limit=${SYNC_RUN_WINDOW}`,
    ),
  ]).then(([list, runs]) =>
    list.ok
      ? {
          ok: true as const,
          items: list.value.items,
          // A failed run list costs the "latest sync" panel, not the page.
          runs: latestRunPerProvider(runs.ok ? runs.value.items : []),
        }
      : { ok: false as const },
  );

  const adapters = await apiAuthedJson<{ items: ProviderCapabilityReport[] }>(
    event,
    '/admin/providers/adapters',
  );

  return {
    providers,
    adapters: adapters.ok ? adapters.value.items : [],
    now: nowIso(),
  };
};

/**
 * Newest run per provider, from one list.
 *
 * The API orders by `startedAt` descending, so the **first** time a provider
 * id appears is its latest run and every later occurrence is history. Written
 * as a fold rather than a sort so it stays correct if the window is short.
 */
function latestRunPerProvider(runs: SyncRunSummary[]): Record<string, SyncRunSummary> {
  const latest: Record<string, SyncRunSummary> = {};

  for (const run of runs) {
    if (!(run.providerId in latest)) latest[run.providerId] = run;
  }

  return latest;
}

/**
 * One action per API endpoint, and no rule restated.
 *
 * The reason's minimum length, which slugs may be registered, whether a
 * disabled provider may be synced — all of that lives in the API and its
 * message is what the operator reads. The BFF forwards.
 */
async function call(
  event: RequestEvent,
  action: 'enable' | 'disable' | 'sync' | 'register',
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  message: string,
) {
  const result = await apiAuthed(event, path, { method, body: JSON.stringify(body) });

  if (!result.ok) {
    if (result.failure.status === 401) redirect(303, '/login');
    return fail(result.failure.status, { ok: false as const, action, message: reason(result.failure) });
  }

  if (!result.value.ok) {
    const failure = await readFailure(result.value);

    if (failure.status === 401) redirect(303, '/login');
    return fail(failure.status, { ok: false as const, action, message: reason(failure) });
  }

  return { ok: true as const, action, message };
}

/**
 * The most specific thing the API said.
 *
 * A validation failure's envelope message is "Validation failed" and the
 * sentence worth reading is on the field — `SetProviderEnabledDto` answers a
 * short reason with *"must explain the change in at least 8 characters"*, and
 * showing the envelope instead tells an operator that something was wrong
 * without saying what.
 *
 * Joined rather than attached to a control, unlike the withdrawal form: these
 * forms are two fields at most and the banner is already beside them.
 */
function reason(failure: ApiFailure): string {
  const fields = failure.fields ?? [];
  if (fields.length === 0) return failure.message;

  return fields.map((field) => `${field.field}: ${field.message}`).join('; ');
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export const actions = {
  enable: async (event) => {
    const form = await event.request.formData();
    const id = field(form, 'providerId');

    return call(
      event,
      'enable',
      `/admin/providers/${id}/enabled`,
      'PATCH',
      { enabled: true, reason: field(form, 'reason') },
      'The provider is enabled. Synchronize its catalog to fill the wall.',
    );
  },

  disable: async (event) => {
    const form = await event.request.formData();
    const id = field(form, 'providerId');

    return call(
      event,
      'disable',
      `/admin/providers/${id}/enabled`,
      'PATCH',
      { enabled: false, reason: field(form, 'reason') },
      'The provider is disabled: not synced, excluded from the wall, and its postbacks rejected.',
    );
  },

  /**
   * Queues a synchronization. It does not wait for one.
   *
   * The API enqueues a job the worker runs (ARCHITECTURE.md §13), so this
   * returns as soon as the run is accepted — the outcome appears on the card
   * when the page is next loaded. A BFF that polled for completion would be
   * holding a request open for the length of a catalog fetch.
   */
  sync: async (event) => {
    const form = await event.request.formData();
    const id = field(form, 'providerId');
    const mode = field(form, 'mode') === 'FULL' ? 'FULL' : 'INCREMENTAL';

    return call(
      event,
      'sync',
      `/admin/catalog/providers/${id}/sync`,
      'POST',
      { mode },
      `A ${mode.toLowerCase()} synchronization was queued. Reload in a moment to see the result.`,
    );
  },

  register: async (event) => {
    const form = await event.request.formData();

    return call(
      event,
      'register',
      '/admin/providers',
      'POST',
      { slug: field(form, 'slug'), displayName: field(form, 'displayName') },
      'The provider is registered. It starts disabled — enable it when you are ready.',
    );
  },
} satisfies Actions;

export const __testing = { latestRunPerProvider, SYNC_RUN_WINDOW };
