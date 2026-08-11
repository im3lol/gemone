<!--
  One offer on the wall — DESIGN_SYSTEM.md §17.1.

  ```
  ┌──────────────────────┐
  │   ███ colour tile ███ │
  │ Skyline Racer — rea…  │
  │ [Games] [Multi-step]  │
  │ 2,450  ≈ $2.45        │
  │ Install and play un…  │
  │ Mock                  │
  └──────────────────────┘
  ```

  **The whole card is one link**, to our own detail page rather than straight
  out to the provider. Legacy's card is an `<a target="_blank">` to the network;
  ours cannot be, and should not be: a click has to be *recorded* before the
  user leaves (PROJECT.md §4.3), and the URL to leave for is built server-side
  by the offer's adapter. A card that linked out directly would either skip the
  attribution record or need the tracking URL in the browser, and the wall
  contract deliberately withholds it.

  ## What is missing from legacy's card, and why

  A **difficulty badge** (`Easy` / `Medium`). Nothing in our catalog knows how
  hard an offer is. It is the one element of §17.1 left out, and inventing it
  from the reward — "expensive means hard" — would be a claim about someone's
  time that we have no basis for.
-->
<script lang="ts">
  import type { WallOffer } from '@gemone/contracts';

  import { Badge } from '$lib/components/ui';
  import { approxCash } from '$lib/payouts/payout';
  import { categoryLabel, categoryTone, formatReward, providerName } from '$lib/offers/offer';

  import OfferTile from './OfferTile.svelte';
  import type { RewardRate } from './types';

  type Props = {
    offer: WallOffer;
    rate: RewardRate;
  };

  let { offer, rate }: Props = $props();

  const cash = $derived(
    rate ? approxCash(offer.rewardPoints, rate.pointsPerCurrencyUnit, rate.currency) : null,
  );
</script>

<a
  href="/offers/{offer.id}"
  class="gm-card gm-card--interactive flex flex-col gap-3 no-underline"
>
  <OfferTile {offer} />

  <div class="flex min-w-0 flex-col gap-2">
    <!--
      `line-clamp-2` rather than legacy's single-line `truncate`: our titles
      carry the completion condition — "Skyline Racer — reach level 12" — and
      cutting that to "Skyline Racer —" hides the part that decides whether
      the offer is worth taking.
    -->
    <p class="line-clamp-2 font-semibold text-text">{offer.title}</p>

    <p class="flex flex-wrap gap-1">
      <Badge variant={categoryTone(offer.category)}>{categoryLabel(offer.category)}</Badge>
      {#if offer.isMultiStep}
        <!-- Real, and worth knowing before starting: the reward arrives in stages. -->
        <Badge variant="neutral">Multi-step</Badge>
      {/if}
    </p>

    <p class="flex items-baseline gap-1.5">
      <span class="text-lg font-bold text-text">{formatReward(offer.rewardPoints)}</span>
      <span class="gm-caption">points</span>
      {#if cash}
        <span class="text-xs font-medium text-brand-600">{cash}</span>
      {/if}
    </p>

    {#if offer.description}
      <p class="line-clamp-2 text-xs text-text-secondary">{offer.description}</p>
    {/if}

    <p class="gm-caption mt-auto">{providerName(offer.providerSlug)}</p>
  </div>
</a>
