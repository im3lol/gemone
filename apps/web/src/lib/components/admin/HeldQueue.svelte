<!--
  The fraud review queue — PROJECT.md §4.7, and the panel that closes the loop.

  *"High-risk conversions are credited but held (not withdrawable) pending
  admin review, rather than rejected outright."* Holding is only the recoverable
  direction if somebody can recover it, and until this screen existed the API
  could fill this queue and nothing could empty it.

  The same shape as every streamed panel since the dashboard (D83): it takes a
  **promise** the page streams from its `load` and owns loading / empty / error
  / populated itself. A `/admin/fraud/held` that fails is a panel that says so,
  not a page that logs the administrator out of the tool they are investigating
  with.

  ## Two empty states, because they mean different things

  An empty queue is the good outcome and should read like one. An empty queue
  *for one account* means that account has nothing held — which is what an
  operator who filtered to it wants to know, and the opposite of "nothing is
  held anywhere".
-->
<script lang="ts">
  import ShieldCheck from '@lucide/svelte/icons/shield-check';

  import { Button, Card, EmptyState, ErrorState, Pager, Skeleton } from '$lib/components/ui';
  import { shortId } from '$lib/admin/fraud';

  import HeldConversion from './HeldConversion.svelte';
  import type { FraudActionResult, HeldQueueResult } from './types';

  type Props = {
    queue: Promise<HeldQueueResult>;
    now: string;
    /** The account the queue is narrowed to, or `''` for every account. */
    userId: string;
    offset: number;
    pageSize: number;
    query: string;
    result: FraudActionResult | null;
  };

  let { queue, now, userId, offset, pageSize, query, result }: Props = $props();

  const params = $derived(new URLSearchParams(query));

  /**
   * The banner belongs to the card whose decision produced it.
   *
   * A resolved hold leaves the queue, so a success has no card left to sit on
   * and is shown above the list. A refusal has one — the conversion is still
   * held — and belongs beside the buttons that were pressed.
   */
  const failureFor = (conversionId: string): FraudActionResult | null =>
    result && !result.ok && result.conversionId === conversionId ? result : null;
</script>

<Card as="section" padding="lg" aria-labelledby="held-title">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 id="held-title" class="gm-card-title">Held conversions</h2>
      <p class="gm-subtitle mt-1">
        Oldest first, because a held conversion is somebody who earned points and cannot spend
        them.
      </p>
    </div>

    {#if userId}
      <div class="flex flex-wrap items-center gap-2">
        <p class="gm-caption">
          Account <span class="font-mono" title={userId}>{shortId(userId)}</span>
        </p>
        <Button href="/admin/fraud" variant="secondary" size="sm">Show every account</Button>
      </div>
    {/if}
  </div>

  <div class="mt-5">
    {#await queue}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading held conversions</span>
        {#each [0, 1, 2] as row (row)}
          <div class="flex flex-col gap-3 rounded-lg border border-border p-5">
            <Skeleton lines={2} height="0.875rem" />
            <Skeleton height="2.25rem" />
          </div>
        {/each}
      </div>
    {:then page}
      {#if !page.ok}
        <ErrorState
          title="The review queue could not be loaded"
          description="No conversion has changed. Refresh the page to try again."
        />
      {:else if page.items.length === 0}
        <EmptyState
          icon={ShieldCheck}
          title={userId ? 'Nothing held for this account' : 'Nothing is waiting for review'}
          description={userId
            ? 'This account has no conversion waiting on a decision.'
            : 'When the fraud engine holds a conversion it arrives here, with the rules that fired.'}
        >
          {#snippet action()}
            {#if userId}
              <Button href="/admin/fraud" variant="secondary" size="sm">Show every account</Button>
            {/if}
          {/snippet}
        </EmptyState>
      {:else}
        <ul class="flex flex-col gap-4">
          {#each page.items as held (held.conversionId)}
            <li>
              <HeldConversion {held} {now} result={failureFor(held.conversionId)} />
            </li>
          {/each}
        </ul>

        <Pager
          {offset}
          {pageSize}
          total={page.total}
          query={params}
          base="/admin/fraud"
          label="Review queue pages"
        />
      {/if}
    {/await}
  </div>
</Card>
