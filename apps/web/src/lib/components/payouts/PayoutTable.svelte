<!--
  Past withdrawal requests — DESIGN_SYSTEM.md §12.

  A real `<table>`, for the reason the statement is one: the columns mean
  something, and `<th scope="col">` is what lets a screen reader say "Amount,
  5,000 points" instead of reading a row as a run-on sentence.

  ## One table, not two layouts

  At 390px four columns do not fit, so **Requested** and **Status** leave the
  table (`hidden sm:table-cell`) and reappear inside the first cell. Same DOM,
  same rows, no second markup tree to keep in step — and no horizontally
  scrolling table.

  ## What is deliberately not here

  The full destination. `PayoutSummary` carries `destinationMasked` and the
  API never sends the rest to this surface (DATABASE.md §3.5) — a payment
  destination in a list response is a payment destination in every browser
  cache and every screenshot. The masked form is enough to recognise which
  account was picked, which is the only thing the owner needs from it.

  The external payment reference is not here either, for the same reason: the
  API does not return it to the requesting user. What is shown is the request's
  own reference, which is the handle a support conversation can use.
-->
<script lang="ts">
  import type { PayoutSummary } from '@gemone/contracts';

  import { Badge } from '$lib/components/ui';
  import { formatCash, methodName, payoutReference, payoutState } from '$lib/payouts/payout';
  import type { PayoutTone } from '$lib/payouts/payout';
  import { absoluteDate, formatPoints, relativeTime } from '$lib/rewards/ledger';

  type Props = {
    items: PayoutSummary[];
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
  };

  let { items, now }: Props = $props();

  const plates: Record<PayoutTone, string> = {
    success: 'bg-brand-50',
    warning: 'bg-warning-soft',
    error: 'bg-danger-soft',
    info: 'bg-info-soft',
    neutral: 'bg-surface-muted',
  };
</script>

<table class="gm-table">
  <thead>
    <tr>
      <th scope="col">Withdrawal</th>
      <th scope="col" class="hidden sm:table-cell">Requested</th>
      <th scope="col" class="hidden sm:table-cell">Status</th>
      <th scope="col" class="gm-num">Amount</th>
    </tr>
  </thead>

  <tbody>
    {#each items as payout (payout.id)}
      {@const state = payoutState(payout.status)}
      <tr>
        <td>
          <div class="flex items-start gap-3">
            <span
              aria-hidden="true"
              class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-block text-base {plates[
                state.tone
              ]}"
            >
              💸
            </span>

            <div class="min-w-0">
              <p class="font-medium text-text">{methodName(payout.method)}</p>
              <p class="truncate text-xs text-text-secondary">{payout.destinationMasked}</p>

              <!-- The two columns that leave the table below `sm`. -->
              <p class="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                <time class="text-xs text-text-muted" datetime={payout.createdAt}>
                  {relativeTime(payout.createdAt, now)}
                </time>
                <Badge variant={state.tone}>{state.label}</Badge>
              </p>

              <!--
                The reason an admin gave, which the user is entitled to see —
                it is the only explanation that exists for a rejection, and
                `reviewReason` is mandatory on exactly those transitions.
              -->
              {#if payout.reviewReason}
                <p class="mt-1 text-xs text-text-secondary">{payout.reviewReason}</p>
              {/if}

              <p class="gm-caption font-mono">Ref {payoutReference(payout.id)}</p>
            </div>
          </div>
        </td>

        <td class="hidden whitespace-nowrap sm:table-cell">
          <time datetime={payout.createdAt} title={absoluteDate(payout.createdAt)}>
            {relativeTime(payout.createdAt, now)}
          </time>
        </td>

        <td class="hidden sm:table-cell">
          <Badge variant={state.tone}>{state.label}</Badge>
          <span class="gm-sr-only">. {state.hint}</span>
        </td>

        <td class="gm-num">
          <p class="font-bold text-text">{formatPoints(payout.amountPoints)}</p>
          <p class="gm-caption">
            {formatCash(payout.cashAmountMinor, payout.cashCurrency)}
            {payout.cashCurrency}
          </p>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
