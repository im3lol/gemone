<!--
  Recent activity — DESIGN_SYSTEM.md §16.4, §11.7.

  The last few ledger movements: what happened, when, how much, and where the
  points are now. A **list, not a table** — the full statement with its columns
  and its pager lives on `/earnings`; this is the five-row summary a dashboard
  is for, and five rows of table at 390px is a horizontal scrollbar nobody
  asked for.

  ## All four states live here

  The component takes a *promise* and owns the whole lifecycle, so there is one
  place that decides what "still loading", "nothing yet", "could not load" and
  "here it is" look like. The page streams the promise from its `load`
  (SvelteKit renders the pending branch server-side and patches it when the
  call returns), which is why the balance cards above are readable before the
  ledger has answered.

  **The promise never rejects.** `load` resolves a discriminated result instead,
  so a failing `/rewards/history` renders an `ErrorState` inside this card
  rather than taking the whole page to SvelteKit's error screen — and, more to
  the point, rather than the redirect-to-login the pre-redesign pages did when
  any call failed. A ledger that will not load is not a finished session.

  ## Announcing it

  `aria-busy` while pending, on the region — one useful announcement instead of
  the row of `Skeleton`s saying "blank" five times (they are `aria-hidden`).
-->
<script lang="ts">
  import Receipt from '@lucide/svelte/icons/receipt';

  import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '$lib/components/ui';
  import {
    absoluteDate,
    describe,
    formatPoints,
    glyph,
    relativeTime,
    statusOf,
  } from '$lib/rewards/ledger';
  import type { LedgerTone } from '$lib/rewards/ledger';

  import type { ActivityResult } from './types';

  type Props = {
    activity: Promise<ActivityResult>;
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
  };

  let { activity, now }: Props = $props();

  /* The glyph plate borrows the status tone rather than introducing a third
     colour map — a reversal reads red, a pending credit amber. */
  const plates: Record<LedgerTone, string> = {
    success: 'bg-brand-50',
    warning: 'bg-warning-soft',
    error: 'bg-danger-soft',
    info: 'bg-info-soft',
    neutral: 'bg-surface-muted',
  };
</script>

<Card as="section" padding="lg" aria-labelledby="activity-title">
  <div class="flex items-center justify-between gap-3">
    <h2 id="activity-title" class="gm-card-title">Recent activity</h2>
    <a href="/earnings" class="shrink-0 text-sm font-semibold text-brand-600">View all →</a>
  </div>

  {#await activity}
    <div aria-busy="true" aria-live="polite" class="mt-4 flex flex-col gap-4">
      <span class="gm-sr-only">Loading your recent activity</span>
      {#each [0, 1, 2, 3, 4] as row (row)}
        <div class="flex items-center gap-3">
          <Skeleton shape="circle" width="2.25rem" height="2.25rem" />
          <div class="flex-1"><Skeleton lines={2} height="0.75rem" /></div>
          <Skeleton width="4rem" height="0.875rem" />
        </div>
      {/each}
    </div>
  {:then result}
    {#if !result.ok}
      <ErrorState
        class="mt-4"
        title="Your activity could not be loaded"
        description="Your balance above is up to date. Refresh the page to try the statement again."
      />
    {:else if result.items.length === 0}
      <EmptyState
        class="mt-4"
        icon={Receipt}
        title="No activity yet"
        description="Complete an offer and the reward shows up here, along with when it clears."
      >
        {#snippet action()}
          <Button href="/offers" size="sm">Browse offers</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="mt-4 flex flex-col gap-1">
        {#each result.items as row (row.id)}
          {@const status = statusOf(row)}
          <li class="flex items-center gap-3 py-2">
            <span
              aria-hidden="true"
              class="grid size-9 shrink-0 place-items-center rounded-block text-base {plates[status.tone]}"
            >
              {glyph(row.type)}
            </span>

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-text">{describe(row.type)}</p>
              {#if row.reason}
                <p class="truncate text-xs text-text-secondary">{row.reason}</p>
              {/if}
              <p class="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <!-- The machine-readable stamp stays on the element, so the
                     exact moment is never lost to a rounded phrase. -->
                <time datetime={row.createdAt} title={absoluteDate(row.createdAt)}>
                  {relativeTime(row.createdAt, now)}
                </time>
                <Badge variant={status.tone}>{status.label}</Badge>
              </p>
            </div>

            <span
              class="gm-num shrink-0 text-sm font-bold {row.amountPoints < 0
                ? 'text-danger-text'
                : row.amountPoints > 0
                  ? 'text-brand-600'
                  : 'text-text-muted'}"
            >
              {formatPoints(row.amountPoints, { signed: true })}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/await}
</Card>
