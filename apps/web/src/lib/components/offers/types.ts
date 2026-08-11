import type { WallOffer } from '@gemone/contracts';

/**
 * Shared prop types for the offer wall — docs/UI_KIT.md.
 *
 * In a `.ts` file for the reason `ui/types.ts` records: a type declared in a
 * Svelte instance script is not reliably re-exportable, and `+page.server.ts`
 * needs the shape without importing a component.
 */

/**
 * What the streamed wall call resolves to.
 *
 * **A result, not a rejection** — D83. The promise is streamed to the browser,
 * and a rejected one takes the whole page to SvelteKit's error screen. The
 * pre-redesign page did worse than that: it answered *any* failed call with
 * `redirect(303, '/login')`, so a catalog endpoint having a bad minute signed
 * people out.
 *
 * `total` rides along because the pager needs it: without the count there is
 * no way to know whether a Next link should exist, and a Next that leads to an
 * empty page is worse than no Next.
 */
export type WallResult =
  | { ok: true; items: WallOffer[]; total: number }
  | { ok: false };

/**
 * The rate a reward is quoted against, when it could be read.
 *
 * `null` when `GET /payouts/options` failed. The cash line then disappears
 * from every card rather than falling back to a rate nobody configured — the
 * same rule the withdrawal screen follows (D86).
 */
export type RewardRate = { pointsPerCurrencyUnit: number; currency: string } | null;
