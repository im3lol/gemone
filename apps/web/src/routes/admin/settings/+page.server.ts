import type { AdminConfigurationKeyList } from '@gemone/contracts';

import type { SettingsListResult } from '$lib/components/admin';
import { apiAuthedJson } from '$lib/server/api';
import { nowIso } from '$lib/time';
import type { PageServerLoad } from './$types';

/**
 * Platform settings — P3, PROJECT.md §3.2, ARCHITECTURE.md §4.9.
 *
 * *"Adjust reward rates, hold periods, withdrawal limits, daily limits, fraud
 * thresholds, currencies — without a developer."* Every one of those has been a
 * database row since the feature that introduced it, and every one has been
 * reachable only by a hand-written `PUT` until this screen.
 *
 * ## Nothing here knows which settings exist
 *
 * `GET /admin/configuration` returns every registered key with its
 * description, declared type, permitted scopes, code default, the value in
 * force and where that value came from. The screen renders that; it holds no
 * list of keys, no labels for them and no ranges.
 *
 * That is not a preference. Keys are declared in code by the module that owns
 * the rule (§4.9) — thirty of them across seven namespaces today — and a
 * hand-written form would be a second declaration that omits the thirty-first
 * the moment somebody registers it.
 *
 * ## Two filters, both the API's
 *
 * `search` and `overriddenOnly` are exactly what `AdminListConfigurationDto`
 * accepts. `overriddenOnly` is the more useful of the two on a real
 * deployment: it answers "what has anybody actually changed", which is the
 * first question asked when behaviour surprises someone.
 *
 * ## Authorization
 *
 * `admin/+layout.server.ts` refuses a non-admin, and
 * `AdminConfigurationController` carries `@Roles(ADMIN)`. The layout check only
 * avoids rendering a page whose every request will fail; the API is the
 * control.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const search = readSearch(url.searchParams.get('search'));
  const overriddenOnly = url.searchParams.get('overriddenOnly') === 'true';

  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (overriddenOnly) query.set('overriddenOnly', 'true');

  const settings: Promise<SettingsListResult> = apiAuthedJson<AdminConfigurationKeyList>(
    event,
    `/admin/configuration${query.toString() ? `?${query}` : ''}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return { settings, search, overriddenOnly, now: nowIso() };
};

/**
 * A search fragment, trimmed and bounded at what the DTO accepts.
 *
 * Bounded here so an over-long paste is dropped rather than becoming a 422
 * that reads as a broken page. Nothing is stripped: the value is a query
 * parameter matched with a `contains`, and a filter that quietly removed
 * characters would search for something other than what was asked for.
 */
const SEARCH_MAX = 100;

function readSearch(raw: string | null): string {
  return (raw ?? '').trim().slice(0, SEARCH_MAX);
}

export const __testing = { readSearch, SEARCH_MAX };
