<!--
  The withdrawal history panel, and all four of its states.

  The same shape as the dashboard's activity card and the earnings statement
  (D83): it takes a **promise** the page streams from its `load`, and owns
  loading / empty / error / populated itself. The balances and the form above
  are usable while this is still open, and a `/payouts` list that fails is a
  panel that says so rather than a page that redirects to the login form.

  No pager. The daily request cap is three, so twenty-five rows is a long
  history rather than a first page — but "twenty-five" is not "all of them",
  and a list that silently stopped would read as though it were complete. When
  there is more, it says so.
-->
<script lang="ts">
  import Receipt from '@lucide/svelte/icons/receipt';

  import { Card, EmptyState, ErrorState, Skeleton } from '$lib/components/ui';

  import PayoutTable from './PayoutTable.svelte';
  import type { PayoutHistoryResult } from './types';

  type Props = {
    history: Promise<PayoutHistoryResult>;
    now: string;
  };

  let { history, now }: Props = $props();
</script>

<!--
  `min-w-0` because this panel is a grid child holding a table. A grid item
  defaults to `min-width: auto`, so a table that cannot shrink below its
  min-content width widens its own track — and the page, not the table, is what
  ends up scrolling sideways.
-->
<Card as="section" padding="lg" class="min-w-0" aria-labelledby="payout-history-title">
  <h2 id="payout-history-title" class="gm-card-title">Your withdrawals</h2>
  <p class="gm-subtitle mt-1">Every request you have made, newest first.</p>

  <div class="mt-5">
    {#await history}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading your withdrawal requests</span>
        {#each [0, 1, 2, 3] as row (row)}
          <div class="flex items-center gap-3">
            <Skeleton shape="circle" width="2.25rem" height="2.25rem" />
            <div class="flex-1"><Skeleton lines={2} height="0.75rem" /></div>
            <Skeleton width="4.5rem" height="0.875rem" />
          </div>
        {/each}
      </div>
    {:then result}
      {#if !result.ok}
        <ErrorState
          title="Your withdrawal history could not be loaded"
          description="Your balance above is up to date and the form still works. Refresh the page to try the history again."
        />
      {:else if result.items.length === 0}
        <EmptyState
          icon={Receipt}
          title="No withdrawals yet"
          description="When you request one it appears here, with what happened to it and why."
        />
      {:else}
        <PayoutTable items={result.items} {now} />

        {#if result.total > result.items.length}
          <p class="gm-caption mt-3">
            Showing your {result.items.length} most recent requests of {result.total}.
          </p>
        {/if}
      {/if}
    {/await}
  </div>
</Card>
