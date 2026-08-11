<!--
  The wall itself, and all four of its states.

  The same shape as the dashboard's activity card, the earnings statement and
  the payout history (D83): it takes a **promise** the page streams from its
  `load`, and owns loading / empty / error / populated itself. The filter bar
  above it stays usable while this is open, and an `/offers` that fails is a
  panel that says so rather than a page that redirects to the login form.

  ## Two empty states, because they mean different things

  "Nothing matches this search" wants the filters cleared. "There are no offers
  at all" is a different fact entirely, and on this platform it has a specific
  cause worth saying out loud: the wall only shows offers from providers a
  click would be accepted for, so an empty catalog usually means no provider is
  enabled yet. Telling somebody "no offers match your filters" when they have
  set no filters would be a lie about their own screen.

  The grid is a `<ul>`. It is a list of things, and a screen reader announcing
  "list, 12 items" is the one piece of structure a wall of cards otherwise
  loses entirely.
-->
<script lang="ts">
  import PackageOpen from '@lucide/svelte/icons/package-open';
  import SearchX from '@lucide/svelte/icons/search-x';

  import { Button, EmptyState, ErrorState, Pager, Skeleton } from '$lib/components/ui';

  import OfferCard from './OfferCard.svelte';
  import type { RewardRate, WallResult } from './types';

  type Props = {
    wall: Promise<WallResult>;
    rate: RewardRate;
    offset: number;
    pageSize: number;
    /** True when any filter narrowed the wall — it changes what "empty" means. */
    filtered: boolean;
    /** The current query string, so the pager can preserve the filters. */
    query: string;
  };

  let { wall, rate, offset, pageSize, filtered, query }: Props = $props();

  const params = $derived(new URLSearchParams(query));

  const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
</script>

{#await wall}
  <!--
    Eight placeholders, the shape of a card: tile, two lines, a reward. The
    count matches the first two rows of the desktop grid, so the layout does
    not jump when the real cards arrive.
  -->
  <div aria-busy="true" aria-live="polite" class={GRID}>
    <span class="gm-sr-only">Loading offers</span>
    {#each [0, 1, 2, 3, 4, 5, 6, 7] as card (card)}
      <div class="gm-card flex flex-col gap-3">
        <Skeleton height="7rem" />
        <Skeleton lines={2} height="0.75rem" />
        <Skeleton width="5rem" height="1rem" />
      </div>
    {/each}
  </div>
{:then result}
  {#if !result.ok}
    <ErrorState
      title="The offer wall could not be loaded"
      description="Your account and balance are unaffected. Refresh the page to try again."
    />
  {:else if result.items.length === 0 && filtered}
    <EmptyState
      icon={SearchX}
      title="No offers match your search"
      description="Try a different word, or widen the category."
    >
      {#snippet action()}
        <Button href="/offers" variant="secondary" size="sm">Show all offers</Button>
      {/snippet}
    </EmptyState>
  {:else if result.items.length === 0}
    <EmptyState
      icon={PackageOpen}
      title="No offers are available right now"
      description="The wall shows offers from providers that are switched on and reachable. Check back shortly."
    />
  {:else}
    <ul class="{GRID} list-none p-0">
      {#each result.items as offer (offer.id)}
        <li class="flex">
          <OfferCard {offer} {rate} />
        </li>
      {/each}
    </ul>

    <Pager
      {offset}
      {pageSize}
      total={result.total}
      query={params}
      base="/offers"
      label="Offer pages"
    />
  {/if}
{/await}
