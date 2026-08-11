<!--
  The offer's colour block — DESIGN_SYSTEM.md §3.5, §17.1.

  Legacy's card opens with a solid colour block carrying one white letter, and
  §3.5 records that the colour comes from a per-offer `color` hex the provider
  supplies. Ours does not have one, so `tileColor` derives it from the offer id
  — stable, decorative, and the fallback §3.5 itself names.

  When the provider did supply an image it is layered **over** the colour as a
  CSS background rather than as an `<img>`: every fixture URL in development
  points at an unreachable host, and a failed `<img>` shows the browser's
  broken-image glyph where a failed background shows the colour that was always
  the design.

  `aria-hidden`, and the letter is not read: it is the title's first character
  repeated, and a screen reader announcing "S, Skyline Racer" is announcing a
  decoration twice.
-->
<script lang="ts">
  import type { WallOffer } from '@gemone/contracts';

  import { tileColor, tileImage, tileInitial } from '$lib/offers/offer';

  type Props = {
    offer: WallOffer;
    /** `h-28` on the grid card, taller on the detail hero (DS §17.1). */
    class?: string;
  };

  let { offer, class: extra = 'h-28' }: Props = $props();

  const image = $derived(tileImage(offer.imageUrl));
</script>

<div
  aria-hidden="true"
  class="grid w-full place-items-center rounded-block bg-cover bg-center text-3xl font-bold text-white {extra}"
  style:background-color={tileColor(offer.id)}
  style:background-image={image}
>
  {#if !image}
    {tileInitial(offer.title, offer.category)}
  {/if}
</div>
