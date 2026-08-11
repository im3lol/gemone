import type { OfferCategory, WallOfferSort } from '@gemone/contracts';

/**
 * Turning a wall offer into something a person can read.
 *
 * The counterpart of `$lib/rewards/ledger.ts` and `$lib/payouts/payout.ts`, and
 * pure for the same reason: these are small judgements about what a user is
 * being offered, and they belong somewhere a test can hold them to a record
 * rather than somewhere they get eyeballed in a rendered grid.
 *
 * **Nothing here invents a field.** `WallOffer` carries a title, a description,
 * requirements, a reward, a category, countries, devices, an image and a
 * multi-step flag — and that is all this module reads. In particular there is
 * no *difficulty*: legacy's card shows an `Easy` / `Medium` badge beside the
 * category (DESIGN_SYSTEM.md §17.1) and nothing in our catalog knows how hard
 * an offer is, so that badge is absent rather than guessed at.
 *
 * ## Why the category and sort names are written out rather than imported
 *
 * `@gemone/contracts` exports `OFFER_CATEGORIES` and `WALL_OFFER_SORTS` as
 * runtime objects, and importing either breaks `vite build` — the package
 * compiles to CommonJS and re-exports through `__exportStar`, which Rollup
 * cannot trace named values through (TODO T79). `Record<OfferCategory, …>` is
 * what keeps these maps honest anyway: a category added to the contract is a
 * compile error here, and a misspelt one is too.
 */

/** A `Badge` variant. Restated rather than imported, so this module depends on nothing. */
export type OfferTone = 'neutral' | 'brand' | 'success' | 'warning' | 'info' | 'purple' | 'indigo' | 'pink';

/**
 * Our eight categories, in the words a user would use.
 *
 * The enum names are the domain's (`APP_INSTALL`), and the pre-redesign wall
 * printed them raw next to the provider slug: `GAME · mock`. Providers each
 * ship their own vocabulary and `offers` maps it onto this closed set; this is
 * the last step of that same journey, from our vocabulary into English.
 */
const LABELS: Record<OfferCategory, string> = {
  GAME: 'Games',
  SURVEY: 'Surveys',
  SIGNUP: 'Sign-ups',
  TRIAL: 'Free trials',
  SHOPPING: 'Shopping',
  APP_INSTALL: 'App installs',
  VIDEO: 'Videos',
  OTHER: 'Other',
};

/**
 * The emoji per category — DESIGN_SYSTEM.md §16.4's activity vocabulary,
 * reused here because it is the same taxonomy said twice: a survey is 📋 on
 * the dashboard's activity list and a survey is 📋 on the wall.
 */
const GLYPHS: Record<OfferCategory, string> = {
  GAME: '🎮',
  SURVEY: '📋',
  SIGNUP: '✍️',
  TRIAL: '🎟️',
  SHOPPING: '🛍️',
  APP_INSTALL: '📱',
  VIDEO: '▶️',
  OTHER: '✨',
};

/**
 * Badge tones, spread across the palette so a mixed wall reads as mixed.
 *
 * **No red.** `Badge` has an `error` variant and none of these use it: red on
 * this screen means something is wrong, and there is nothing wrong with a
 * video offer. The tones follow legacy's activity tints where they exist
 * (§16.4) — video is pink there, and pink here.
 */
const TONES: Record<OfferCategory, OfferTone> = {
  GAME: 'purple',
  SURVEY: 'info',
  SIGNUP: 'indigo',
  TRIAL: 'warning',
  SHOPPING: 'brand',
  APP_INSTALL: 'success',
  VIDEO: 'pink',
  OTHER: 'neutral',
};

/**
 * Every category the filter offers.
 *
 * Derived from the map rather than written a fourth time, and correct by
 * construction: `Record<OfferCategory, …>` refuses a missing key and an object
 * literal refuses an extra one, so this array *is* the contract's set.
 */
export const OFFER_CATEGORIES_IN_ORDER = Object.keys(LABELS) as OfferCategory[];

/**
 * The fallbacks exist because the category is a wire value.
 *
 * The union is closed in the contract and a running API is still free to send
 * something this build has never heard of — a newer server, a replayed record.
 * A lookup returning `undefined` would render "undefined" onto a card.
 */
export function categoryLabel(category: OfferCategory): string {
  return LABELS[category] ?? 'Other';
}

export function categoryGlyph(category: OfferCategory): string {
  return GLYPHS[category] ?? '✨';
}

export function categoryTone(category: OfferCategory): OfferTone {
  return TONES[category] ?? 'neutral';
}

/** How the wall can be ordered, in the order the dropdown lists them. */
const SORTS: Record<WallOfferSort, string> = {
  reward_desc: 'Highest reward',
  reward_asc: 'Lowest reward',
  newest: 'Newest first',
};

export const OFFER_SORTS_IN_ORDER = Object.keys(SORTS) as WallOfferSort[];

export function sortLabel(sort: WallOfferSort): string {
  return SORTS[sort] ?? 'Highest reward';
}

/**
 * The offer tile's colour — DESIGN_SYSTEM.md §3.5.
 *
 * Legacy carries a per-offer `color` hex from the provider and paints the tile
 * with it. Our `WallOffer` has no colour and adding one to the contract would
 * mean every adapter inventing a palette, so the tile colour is **derived from
 * the offer id**: the fallback §3.5 names, and the one the UI audit's §5.8 said
 * to decide on before building.
 *
 * Two properties matter and both are deliberate:
 *
 * - **Stable.** The same offer is the same colour on every render, every
 *   process, and after a redeploy — it is a hash of the id, not a counter or a
 *   random pick. A wall that reshuffled its colours on reload would look
 *   broken.
 * - **Decoration only.** Nothing is communicated by which colour appears, so a
 *   collision costs nothing. It exists to give the grid texture, which §3.5
 *   records as the thing that is lost if every tile is one colour.
 *
 * The palette is legacy's own observed values (§3.5), not a new one.
 */
const TILE_COLORS = [
  '#059669',
  '#4f46e5',
  '#b91c1c',
  '#f59e0b',
  '#10b981',
  '#dc2626',
  '#111827',
  '#00d54b',
] as const;

export function tileColor(id: string): string {
  // FNV-1a, for no reason beyond being short, stable and well spread over
  // short strings. `>>> 0` keeps it unsigned after the multiply overflows.
  let hash = 0x811c9dc5;

  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return TILE_COLORS[hash % TILE_COLORS.length] as string;
}

/**
 * The single character on the tile — legacy's `icon`, which we do not have.
 *
 * The first letter of the title, which is what a person would pick. Falls back
 * to the category glyph for a title that starts with something unprintable, so
 * the tile is never blank.
 */
export function tileInitial(title: string, category: OfferCategory): string {
  const letter = title.trim().match(/\p{L}|\p{N}/u)?.[0];

  return letter ? letter.toUpperCase() : categoryGlyph(category);
}

/**
 * A provider image, or nothing — and nothing is the common case.
 *
 * `WallOffer.imageUrl` is whatever the provider put in its catalog, which
 * makes it the one field on this screen that came from outside our system and
 * is rendered as a *URL* rather than as text. Two things follow:
 *
 * - **`https:` only.** A `javascript:` or `data:` value has no business in an
 *   image slot, and rejecting everything else is cheaper than reasoning about
 *   what a browser does with the rest.
 * - **Rendered as a CSS background over the tile colour, never as `<img>`.**
 *   A provider host that is unreachable — every one of them in development,
 *   where the fixture points at `cdn.mock-offers.test` — leaves an `<img>`
 *   showing the browser's broken-image glyph. A background image that fails to
 *   load leaves the colour underneath, which is the design either way and
 *   needs no JavaScript to fall back.
 */
export function tileImage(imageUrl: string | null): string | undefined {
  if (!imageUrl) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:') return undefined;

  // Set through the CSSOM by Svelte's `style:` directive, which drops a value
  // it cannot parse rather than concatenating it into a stylesheet — so this
  // is belt to that braces, not the only guard.
  return `url("${parsed.href.replaceAll('"', '%22')}")`;
}

/*
 * There is no `providerName` helper here any more, and that is the fix.
 *
 * This module used to title-case the slug — `mock` into "Mock" — because
 * `WallOffer` carried nothing else, and it was wrong for the first real
 * provider whose name is not a plain word: `adgem` rendered as "Adgem".
 *
 * `WallOffer.providerName` now carries `providers.display_name`, resolved
 * server-side from the registry snapshot the wall already consults (TODO T82).
 * A component reads the field. Nothing in the browser holds a list of provider
 * names, which is both a second source of truth and the "code knows which
 * provider it is talking to" that P1 forbids.
 */

/** Points, grouped. The same formatting as the ledger's, for the same numbers. */
export function formatReward(points: number): string {
  return points.toLocaleString('en-US');
}
