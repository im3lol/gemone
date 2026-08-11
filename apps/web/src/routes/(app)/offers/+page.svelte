<!--
  Offers — DESIGN_SYSTEM.md §17.1, PROJECT.md §3.2.

  ```
  Offers                                       Earnings →
  [ Search ] [ Category ▾ ] [ Sort ▾ ] [Search]
  ┌────┐ ┌────┐ ┌────┐ ┌────┐
  │card│ │card│ │card│ │card│      1 / 2 / 3 / 4 columns
  └────┘ └────┘ └────┘ └────┘
              Previous  1–12 of 24  Next
  ```

  The one screen where money *enters* the system, and the destination of every
  empty state on every other page — the dashboard, the statement and the
  withdrawal form all end with "Browse offers", and this is what they mean.

  Unlike `/earnings` and `/payouts` the wall is not wrapped in a `Card`: these
  are already cards, and a grid of cards inside a card is a border around a
  border. The filter bar sits on the page ground for the same reason.
-->
<script lang="ts">
  import Receipt from '@lucide/svelte/icons/receipt';

  import { OfferFilters, OfferWall } from '$lib/components/offers';
  import { Button, PageHeader } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head><title>Offers · GemOne</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader title="Offers" description="Complete an offer and the reward lands on your balance.">
    {#snippet actions()}
      <Button href="/earnings" variant="secondary">
        <Receipt size={16} aria-hidden="true" />
        Earnings
      </Button>
    {/snippet}
  </PageHeader>

  <OfferFilters search={data.search} category={data.category} sort={data.sort} />

  <OfferWall
    wall={data.wall}
    rate={data.payoutOptions}
    offset={data.offset}
    pageSize={data.pageSize}
    filtered={data.filtered}
    query={data.query}
  />
</div>
