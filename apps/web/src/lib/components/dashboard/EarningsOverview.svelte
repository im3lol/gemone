<!--
  Earnings overview — the simple visual summary, built from data that already
  exists.

  Two things, both answering a question the four stat cards leave open:

  1. **Where the current balance sits.** A single stacked bar across
     available / pending / locked, with a legend that carries the actual
     figures. Someone with 12,000 points and 11,000 of them pending reads
     "mostly waiting" in one glance, which no column of separate numbers gives
     them.
  2. **What has happened over the life of the account** — earned, withdrawn,
     reversed. Three figures the API already returns on `/rewards/balance` and
     that nothing else in the product displays.

  ## No chart library

  The bar is three `<div>`s with percentage widths. A charting dependency for
  one stacked bar would be several hundred kilobytes to draw a rectangle, and
  the phase brief rules it out; this is the shape the data actually has.

  ## The bar is `aria-hidden`

  It is a picture of the legend beneath it. Announcing both means hearing every
  figure twice, and the legend is the version that carries units.
-->
<script lang="ts">
  import type { Balance } from '@gemone/contracts';

  import { Card } from '$lib/components/ui';
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = { balance: Balance | null };

  let { balance }: Props = $props();

  /*
   * `total` is `pending + available + locked` and the contract guarantees it,
   * but the divisor is recomputed here rather than trusted: this file divides
   * by it, and a zero from a partially-populated response would produce
   * `Infinity%` widths on someone's balance bar.
   */
  const held = $derived(
    balance ? balance.available + balance.pending + balance.locked : 0,
  );

  const buckets = $derived(
    balance
      ? [
          { key: 'available', label: 'Available', points: balance.available, bar: 'bg-brand-500', dot: 'bg-brand-500' },
          { key: 'pending', label: 'Pending', points: balance.pending, bar: 'bg-warning', dot: 'bg-warning' },
          { key: 'locked', label: 'Locked', points: balance.locked, bar: 'bg-info', dot: 'bg-info' },
        ]
      : [],
  );

  const share = (points: number) => (held > 0 ? (points / held) * 100 : 0);

  const lifetime = $derived(
    balance
      ? [
          { label: 'Earned', points: balance.lifetimeEarned },
          { label: 'Withdrawn', points: balance.lifetimeWithdrawn },
          { label: 'Reversed', points: balance.lifetimeReversed },
        ]
      : [],
  );
</script>

<Card as="section" padding="lg" aria-labelledby="overview-title">
  <h2 id="overview-title" class="gm-card-title">Earnings overview</h2>
  <p class="gm-subtitle mt-1">Where your points are right now.</p>

  {#if !balance}
    <p class="gm-hint mt-4">Your balance could not be loaded. Refresh to try again.</p>
  {:else if held === 0}
    <p class="gm-hint mt-4">
      Nothing on your balance yet. Points appear here once an offer is credited.
    </p>
  {:else}
    <div aria-hidden="true" class="mt-4 flex h-2.5 overflow-hidden rounded-control bg-border">
      {#each buckets as bucket (bucket.key)}
        {#if bucket.points > 0}
          <div class={bucket.bar} style:width="{share(bucket.points)}%"></div>
        {/if}
      {/each}
    </div>

    <dl class="mt-4 flex flex-col gap-2.5">
      {#each buckets as bucket (bucket.key)}
        <div class="flex items-center gap-2 text-sm">
          <span aria-hidden="true" class="size-2.5 shrink-0 rounded-control {bucket.dot}"></span>
          <dt class="flex-1 text-text-body">{bucket.label}</dt>
          <dd class="gm-num font-semibold text-text">
            {formatPoints(bucket.points)}
            <span class="ml-1 text-xs font-normal text-text-muted">
              {Math.round(share(bucket.points))}%
            </span>
          </dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if balance}
    <dl class="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
      {#each lifetime as entry (entry.label)}
        <div>
          <dt class="gm-caption">{entry.label}</dt>
          <dd class="mt-0.5 text-base font-bold tabular-nums text-text">
            {formatPoints(entry.points)}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
</Card>
