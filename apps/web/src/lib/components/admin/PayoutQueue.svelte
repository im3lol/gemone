<!--
  The queue panel — status tabs, table, pager, and all four of its states.

  The same shape as every streamed panel since the dashboard (D83): it takes a
  **promise** the page streams from its `load`, and owns loading / empty /
  error / populated itself. The tabs stay usable while the list is open, and an
  `/admin/payouts` that fails is a panel that says so rather than a page that
  logs the administrator out of the tool they were investigating with.

  ## The tabs are links

  Each status is a URL, so the queue is bookmarkable — "the pending queue" is a
  link an admin can keep — and the Back button works. No JavaScript is involved
  in filtering it.

  `aria-current="page"` rather than a class alone: which tab is active is
  information, not decoration, and a colour is not available to a screen reader.
-->
<script lang="ts">
  import Inbox from '@lucide/svelte/icons/inbox';
  import type { PayoutStatus } from '@gemone/contracts';

  import { Card, EmptyState, ErrorState, Pager, Skeleton } from '$lib/components/ui';
  import { PAYOUT_STATUSES_IN_QUEUE_ORDER, queueState } from '$lib/admin/payout-queue';

  import QueueTable from './QueueTable.svelte';
  import type { QueueResult } from './types';

  type Props = {
    queue: Promise<QueueResult>;
    now: string;
    /** The active tab, or `''` for every status. */
    status: PayoutStatus | '';
    offset: number;
    pageSize: number;
    query: string;
  };

  let { queue, now, status, offset, pageSize, query }: Props = $props();

  const params = $derived(new URLSearchParams(query));

  const tabs = $derived([
    { value: '' as const, label: 'All' },
    ...PAYOUT_STATUSES_IN_QUEUE_ORDER.map((value) => ({ value, label: queueState(value).label })),
  ]);

  const tabHref = (value: PayoutStatus | '') => (value ? `/admin/payouts?status=${value}` : '/admin/payouts');
</script>

<Card as="section" padding="lg" aria-labelledby="queue-title">
  <h2 id="queue-title" class="gm-card-title">Payout queue</h2>
  <p class="gm-subtitle mt-1">
    Oldest first while pending, so the queue is worked in the order people joined it.
  </p>

  <nav aria-label="Payout status" class="mt-4 flex flex-wrap gap-2">
    {#each tabs as tab (tab.value)}
      <a
        href={tabHref(tab.value)}
        aria-current={status === tab.value ? 'page' : undefined}
        class="gm-btn gm-btn--sm {status === tab.value ? 'gm-btn--primary' : 'gm-btn--secondary'}"
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  <div class="mt-5">
    {#await queue}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading the payout queue</span>
        {#each [0, 1, 2, 3, 4, 5] as row (row)}
          <div class="flex items-center gap-3">
            <div class="flex-1"><Skeleton lines={2} height="0.75rem" /></div>
            <Skeleton width="5rem" height="0.875rem" />
            <Skeleton width="4rem" height="2rem" />
          </div>
        {/each}
      </div>
    {:then result}
      {#if !result.ok}
        <ErrorState
          title="The payout queue could not be loaded"
          description="No request has changed. Refresh the page to try again."
        />
      {:else if result.items.length === 0}
        <!--
          One empty state, not two. Every tab is a filter, including "All" —
          and an empty "All" and an empty "Rejected" are the same sentence with
          a different noun, so the noun does the work.
        -->
        <EmptyState
          icon={Inbox}
          title={status ? `No ${queueState(status).label.toLowerCase()} requests` : 'No payout requests yet'}
          description={status
            ? 'Nothing in the queue has this status.'
            : 'When somebody requests a withdrawal it arrives here for review.'}
        />
      {:else}
        <QueueTable items={result.items} {now} />

        <Pager
          {offset}
          {pageSize}
          total={result.total}
          query={params}
          base="/admin/payouts"
          label="Queue pages"
        />
      {/if}
    {/await}
  </div>
</Card>
