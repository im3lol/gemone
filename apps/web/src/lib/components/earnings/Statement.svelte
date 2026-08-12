<!--
  The statement panel — filter, table, pager, and all four of its states.

  The same shape as the dashboard's activity card (D83): it takes a **promise**
  that the page streams from its `load`, and it owns loading / empty / error /
  populated itself. The balance cards above are readable while this is still
  open, and a `/rewards/history` that fails is a panel that says so rather than
  a page that redirects to the login form.

  ## Two empty states, because they mean different things

  "You have not earned anything yet" wants an offer wall. "Nothing matches this
  filter" wants the filter cleared. Showing the first when someone has filtered
  to `Withdrawal paid` and has never withdrawn is telling them they have no
  earnings, on a page that is displaying their earnings.
-->
<script lang="ts">
  import Receipt from '@lucide/svelte/icons/receipt';
  import type { RewardStatus, RewardTransactionType } from '@gemone/contracts';

  import { Button, Card, EmptyState, ErrorState, Pager, Skeleton } from '$lib/components/ui';
  import { describe, statusLabel } from '$lib/rewards/ledger';

  import StatementFilter from './StatementFilter.svelte';
  import StatementTable from './StatementTable.svelte';
  import type { StatementResult } from './types';

  type Props = {
    statement: Promise<StatementResult>;
    now: string;
    offset: number;
    pageSize: number;
    /** The active type filter, or `''` for everything. */
    type: RewardTransactionType | '';
    /** The active status filter, or `''` for everything. */
    status: RewardStatus | '';
    /** The current query string, so the pager can preserve the filters. */
    query: string;
  };

  let { statement, now, offset, pageSize, type, status, query }: Props = $props();

  const params = $derived(new URLSearchParams(query));

  /*
   * What the user asked for, in the words the controls used.
   *
   * Named rather than described generically, because "no results" and "no
   * results *for this*" are answered differently: the second one tells someone
   * which control to change.
   */
  const applied = $derived(
    [type ? describe(type) : '', status ? statusLabel(status) : ''].filter(Boolean),
  );
</script>

<Card as="section" padding="lg" aria-labelledby="statement-title">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h2 id="statement-title" class="gm-card-title">Statement</h2>
      <p class="gm-subtitle mt-1">Every movement on your balance, newest first.</p>
    </div>

    <StatementFilter {type} {status} />
  </div>

  <div class="mt-5">
    {#await statement}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading your statement</span>
        {#each [0, 1, 2, 3, 4, 5, 6, 7] as row (row)}
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
          title="Your statement could not be loaded"
          description="Your balance above is up to date. Refresh the page to try the statement again."
        />
      {:else if result.items.length === 0 && applied.length > 0}
        <EmptyState
          icon={Receipt}
          title="No movements match this filter"
          description="Your statement has nothing under {applied.join(' and ')}."
        >
          {#snippet action()}
            <Button href="/earnings" variant="secondary" size="sm">Show all movements</Button>
          {/snippet}
        </EmptyState>
      {:else if result.items.length === 0}
        <EmptyState
          icon={Receipt}
          title="Nothing on your balance yet"
          description="Complete an offer and the reward appears here, with the date it clears and where the points sit."
        >
          {#snippet action()}
            <Button href="/offers" size="sm">Browse offers</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <StatementTable items={result.items} {now} />
        <Pager
          {offset}
          {pageSize}
          total={result.total}
          query={params}
          base="/earnings"
          label="Statement pages"
        />
      {/if}
    {/await}
  </div>
</Card>
