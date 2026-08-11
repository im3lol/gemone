<!--
  The payout queue — DESIGN_SYSTEM.md §12, ARCHITECTURE.md §11.3.

  A real `<table>`: this is a work queue, the columns are compared down the
  page, and `<th scope="col">` is what lets a screen reader say "Points, 5,000"
  instead of reading a row as a run-on sentence.

  ## What is deliberately not a column

  **The payment destination.** DATABASE.md §3.5 keeps it off every list
  response and puts it on the detail view alone, which is audited — a queue
  that showed destinations would put every user's bank details in one response,
  one browser cache and one screenshot. `AdminPayoutSummary` does not carry it
  at all, so this is the contract's decision showing through rather than a
  choice made here.

  **An email address.** For the same reason, and the summary carries no name or
  address either. The account column is a short form of the id: enough to tell
  two rows apart and read out loud, not an identity. What an admin decides on
  is on the detail view — account age, status, conversions, chargebacks, fraud
  signals.

  ## One table, not two layouts

  Below `md` the queue keeps **Account** and **Amount** and moves the rest into
  the first cell. Same DOM, same rows, no second markup tree, and no table
  scrolling sideways.
-->
<script lang="ts">
  import type { AdminPayoutSummary } from '@gemone/contracts';

  import { Badge, Button } from '$lib/components/ui';
  import { accountReference, payoutReference, queueState } from '$lib/admin/payout-queue';
  import { methodName } from '$lib/payouts/payout';
  import { absoluteDate, formatPoints, relativeTime } from '$lib/rewards/ledger';
  import { formatCash } from '$lib/payouts/payout';

  type Props = {
    items: AdminPayoutSummary[];
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
  };

  let { items, now }: Props = $props();
</script>

<table class="gm-table">
  <thead>
    <tr>
      <th scope="col">Account</th>
      <th scope="col" class="hidden md:table-cell">Method</th>
      <th scope="col" class="hidden md:table-cell">Requested</th>
      <th scope="col" class="hidden md:table-cell">Status</th>
      <th scope="col" class="gm-num">Amount</th>
      <th scope="col"><span class="gm-sr-only">Review</span></th>
    </tr>
  </thead>

  <tbody>
    {#each items as payout (payout.id)}
      {@const state = queueState(payout.status)}
      <tr>
        <td>
          <p class="font-mono font-medium text-text">{accountReference(payout.userId)}</p>
          <p class="gm-caption font-mono">Ref {payoutReference(payout.id)}</p>

          <!-- The three columns that leave the table below `md`. -->
          <p class="mt-1 flex flex-wrap items-center gap-2 md:hidden">
            <span class="text-xs text-text-secondary">{methodName(payout.method)}</span>
            <time class="text-xs text-text-muted" datetime={payout.createdAt}>
              {relativeTime(payout.createdAt, now)}
            </time>
            <Badge variant={state.tone}>{state.label}</Badge>
          </p>

          {#if payout.externalReference}
            <p class="gm-caption font-mono">Paid as {payout.externalReference}</p>
          {:else if payout.reviewReason}
            <p class="text-xs text-text-secondary">{payout.reviewReason}</p>
          {/if}
        </td>

        <td class="hidden md:table-cell">{methodName(payout.method)}</td>

        <td class="hidden whitespace-nowrap md:table-cell">
          <time datetime={payout.createdAt} title={absoluteDate(payout.createdAt)}>
            {relativeTime(payout.createdAt, now)}
          </time>
        </td>

        <td class="hidden md:table-cell">
          <Badge variant={state.tone}>{state.label}</Badge>
        </td>

        <td class="gm-num">
          <p class="font-bold text-text">{formatPoints(payout.amountPoints)}</p>
          <p class="gm-caption">
            {formatCash(payout.cashAmountMinor, payout.cashCurrency)}
            {payout.cashCurrency}
          </p>
        </td>

        <td>
          <!--
            "Review" for something still open, "Open" for a settled record —
            an admin clicking into a paid request is reading it, not deciding
            on it, and the label should not suggest a decision is outstanding.
          -->
          <Button href="/admin/payouts/{payout.id}" variant="secondary" size="sm">
            {payout.status === 'PENDING_REVIEW' || payout.status === 'APPROVED'
              ? 'Review'
              : 'Open'}
          </Button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
