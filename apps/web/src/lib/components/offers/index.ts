/**
 * The offer wall — DESIGN_SYSTEM.md §3.5, §17.1, PROJECT.md §3.2.
 *
 * `OfferWall` is the only piece a page needs; the filter bar sits above it and
 * the card and tile are its parts. None of them fetches, and none decides what
 * an offer *means* — that lives in `$lib/offers/offer.ts`, where a test can
 * hold it to a record.
 *
 * Nothing here knows which network an offer came from beyond its slug, which
 * is the wall contract's own guarantee (P1) carried through to the pixels: a
 * real provider replaces the mock without touching one of these files.
 */
export { default as OfferCard } from './OfferCard.svelte';
export { default as OfferFilters } from './OfferFilters.svelte';
export { default as OfferTile } from './OfferTile.svelte';
export { default as OfferWall } from './OfferWall.svelte';

export type { RewardRate, WallResult } from './types';
