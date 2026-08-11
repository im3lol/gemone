<!--
  The statement — DESIGN_SYSTEM.md §12, §16.4.

  A real `<table>`, because this is a ledger: the columns mean something, and a
  `<th scope="col">` is what lets a screen reader say "Points, minus 800"
  instead of reading a row as a run-on sentence. The dashboard's five-row
  summary is a list for the opposite reason — no columns to compare.

  ## One table, not two layouts

  At 390px four columns do not fit, so **When** and **Status** drop out of the
  table (`hidden sm:table-cell`) and reappear inside the first cell, under the
  movement name. Same DOM, same rows, no second markup tree to keep in step —
  and no horizontally scrolling table, which is the thing the phase brief rules
  out. The date string is the only thing rendered twice.

  ## The offer name

  `sourceLabel` is the point of this screen and the resolution of TODO T77: the
  offer title as it was shown at click time, recorded on the movement when the
  points moved. Rows written before the column existed carry `null` and simply
  show no second line — there is no honest way to recover a name for them, and
  today's catalog title would be the wrong one.
-->
<script lang="ts">
  import type { RewardTransactionRecord } from '@gemone/contracts';

  import { Badge } from '$lib/components/ui';
  import {
    absoluteDate,
    describe,
    formatPoints,
    glyph,
    relativeTime,
    statusOf,
  } from '$lib/rewards/ledger';
  import type { LedgerTone } from '$lib/rewards/ledger';

  type Props = {
    items: RewardTransactionRecord[];
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
  };

  let { items, now }: Props = $props();

  const plates: Record<LedgerTone, string> = {
    success: 'bg-brand-50',
    warning: 'bg-warning-soft',
    error: 'bg-danger-soft',
    info: 'bg-info-soft',
    neutral: 'bg-surface-muted',
  };

  const amountTone = (points: number) =>
    points < 0 ? 'text-danger-text' : points > 0 ? 'text-brand-600' : 'text-text-muted';
</script>

<table class="gm-table">
  <thead>
    <tr>
      <th scope="col">Movement</th>
      <th scope="col" class="hidden sm:table-cell">When</th>
      <th scope="col" class="hidden sm:table-cell">Status</th>
      <th scope="col" class="gm-num">Points</th>
    </tr>
  </thead>

  <tbody>
    {#each items as row (row.id)}
      {@const status = statusOf(row)}
      <tr>
        <td>
          <div class="flex items-start gap-3">
            <span
              aria-hidden="true"
              class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-block text-base {plates[
                status.tone
              ]}"
            >
              {glyph(row.type)}
            </span>

            <div class="min-w-0">
              <p class="font-medium text-text">{describe(row.type)}</p>

              {#if row.sourceLabel}
                <p class="text-xs text-text-secondary">{row.sourceLabel}</p>
              {:else if row.reason}
                <p class="text-xs text-text-secondary">{row.reason}</p>
              {/if}

              <!-- The two columns that leave the table below `sm`. -->
              <p class="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                <time class="text-xs text-text-muted" datetime={row.createdAt}>
                  {relativeTime(row.createdAt, now)}
                </time>
                <Badge variant={status.tone}>{status.label}</Badge>
              </p>
            </div>
          </div>
        </td>

        <td class="hidden whitespace-nowrap sm:table-cell">
          <time datetime={row.createdAt} title={absoluteDate(row.createdAt)}>
            {relativeTime(row.createdAt, now)}
          </time>
        </td>

        <td class="hidden sm:table-cell">
          <Badge variant={status.tone}>{status.label}</Badge>
        </td>

        <td class="gm-num font-bold {amountTone(row.amountPoints)}">
          {formatPoints(row.amountPoints, { signed: true })}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
