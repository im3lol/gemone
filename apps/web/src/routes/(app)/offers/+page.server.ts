import type { OfferCategory, Paginated, WallOffer, WallOfferSort } from '@gemone/contracts';

import type { WallResult } from '$lib/components/offers';
import { OFFER_CATEGORIES_IN_ORDER, OFFER_SORTS_IN_ORDER } from '$lib/offers/offer';
import { apiAuthedJson } from '$lib/server/api';
import type { PageServerLoad } from './$types';

/** `GET /offers` caps `limit` at 100. Twelve fills three desktop rows. */
const PAGE_SIZE = 12;

/**
 * The offer wall — PROJECT.md §3.2, DESIGN_SYSTEM.md §17.1.
 *
 * ## Streaming, and why the promise resolves instead of rejecting
 *
 * D83. The wall is returned unawaited, so the page header and the filter bar
 * paint while the catalog call is open, and a failure resolves `{ ok: false }`
 * rather than rejecting — a rejected streamed promise takes the whole page to
 * SvelteKit's error screen.
 *
 * The version this replaces answered *any* failed call with
 * `redirect(303, '/login')`, so a catalog endpoint having a bad minute logged
 * people out. The session is the layout's business, and the hook's before that.
 *
 * ## What is not read here
 *
 * The balance, and the rate every card quotes `≈ $2.45` from. Both come from
 * `(app)/+layout.server.ts` with the rest of the shell — the rate joined it in
 * T83, when the dashboard and the statement needed the same number and four
 * pages fetching one value would have been T74 all over again.
 */
export const load: PageServerLoad = (event) => {
  const { url } = event;

  const search = url.searchParams.get('search')?.trim() ?? '';
  const category = readCategory(url.searchParams.get('category'));
  const sort = readSort(url.searchParams.get('sort'));
  const offset = readOffset(url.searchParams.get('offset'));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (search) query.set('search', search);
  if (category) query.set('category', category);
  if (sort) query.set('sort', sort);
  if (offset > 0) query.set('offset', String(offset));

  const wall: Promise<WallResult> = apiAuthedJson<Paginated<WallOffer>>(
    event,
    `/offers?${query}`,
  ).then((result) =>
    result.ok ? { ok: true, items: result.value.items, total: result.value.total } : { ok: false },
  );

  return {
    wall,
    search,
    category,
    sort,
    offset,
    pageSize: PAGE_SIZE,
    /** Whether anything narrowed the wall — it decides which empty state to show. */
    filtered: Boolean(search || category),
    /** What the pager must preserve. The page's own params, not the API's. */
    query: url.search,
  };
};

/**
 * Only a category the UI knows about survives.
 *
 * `?category=DROP+TABLE` reaching the API is a 422, which would turn into the
 * wall's error state — a filter nobody chose failing a page that works.
 * `OFFER_CATEGORIES_IN_ORDER` is the same list the dropdown renders, so the
 * guard cannot drift from what is on offer.
 */
function readCategory(raw: string | null): OfferCategory | '' {
  if (!raw) return '';

  return OFFER_CATEGORIES_IN_ORDER.includes(raw as OfferCategory) ? (raw as OfferCategory) : '';
}

/** Same guard for the ordering; an unknown sort is the API's default, not a 422. */
function readSort(raw: string | null): WallOfferSort | '' {
  if (!raw) return '';

  return OFFER_SORTS_IN_ORDER.includes(raw as WallOfferSort) ? (raw as WallOfferSort) : '';
}

/**
 * An unparseable offset is page one, not `NaN` offers into the catalog.
 *
 * `?offset=abc` used to reach the page as `NaN` and render "NaN–NaN of 2" in
 * the pager.
 */
function readOffset(raw: string | null): number {
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export const __testing = { readCategory, readSort, readOffset, PAGE_SIZE };
