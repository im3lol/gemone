<!--
  Reviewing one withdrawal — ARCHITECTURE.md §11.3, DATABASE.md §3.5.

  ```
  ← Payout queue
  5,000 points · $5.00 USD · Ref 1442C767      [Pending review]
  ┌───────────────────────────┐ ┌──────────────────────────────┐
  │ Send the money to         │ │ Decide                       │
  │ the destination           │ │ Approve / Reject             │
  ├───────────────────────────┤ └──────────────────────────────┘
  │ The account               │
  │ age · status · balances   │
  │ conversions · chargebacks │
  │ fraud signals             │
  └───────────────────────────┘
  ```

  The decision panel is second in the DOM so it comes first on a phone: an
  admin opening this on a phone is deciding, and the evidence is what they
  scroll to. On desktop it sits beside the evidence rather than under it.

  ## The destination is shown, and that is the point

  This is the only view in the product that returns a payment destination — the
  admin has to read it to send the money. §3.5 pairs that with an audit entry
  written on the read, so the panel says so out loud rather than leaving the
  administrator to discover it.
-->
<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  import { ReviewActions, ReviewContext } from '$lib/components/admin';
  import { Badge, Card } from '$lib/components/ui';
  import { payoutReference, queueState, accountReference } from '$lib/admin/payout-queue';
  import { formatCash, methodName } from '$lib/payouts/payout';
  import { absoluteDate, formatPoints } from '$lib/rewards/ledger';

  let { data, form } = $props();

  const payout = $derived(data.payout);
  const state = $derived(queueState(payout.status));
</script>

<svelte:head><title>Payout {payoutReference(payout.id)} · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <a
    href="/admin/payouts"
    class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary"
  >
    <ArrowLeft size={16} aria-hidden="true" />
    Payout queue
  </a>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="font-display text-2xl font-bold tracking-tight text-text">
        {formatPoints(payout.amountPoints)} points
      </h1>
      <p class="gm-subtitle mt-1">
        {formatCash(payout.cashAmountMinor, payout.cashCurrency)}
        {payout.cashCurrency} · requested {absoluteDate(payout.createdAt)} ·
        account <span class="font-mono">{accountReference(payout.userId)}</span> ·
        ref <span class="font-mono">{payoutReference(payout.id)}</span>
      </p>
    </div>

    <Badge variant={state.tone}>{state.label}</Badge>
  </div>

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
    <!-- Second in the DOM, first on a phone. -->
    <div class="flex flex-col gap-5 lg:order-2">
      <ReviewActions status={payout.status} result={form} />
    </div>

    <div class="flex flex-col gap-5 lg:order-1">
      <Card as="section" padding="lg" class="flex flex-col gap-3" aria-labelledby="destination-title">
        <div>
          <h2 id="destination-title" class="gm-card-title">Send the money to</h2>
          <p class="gm-subtitle mt-1">
            {methodName(payout.method)} · at the rate of {payout.pointsPerCurrencyUnit.toLocaleString(
              'en-US',
            )} points per {payout.cashCurrency}, as stored on this request.
          </p>
        </div>

        <!--
          `break-all` because a destination can be an IBAN or a wallet address
          with no spaces in it, and one that overflowed its card would be one
          an admin cannot read — on the single screen where reading it exactly
          is the whole job.
        -->
        <p class="rounded-block border border-border bg-surface-muted px-3 py-2 font-mono break-all text-text">
          {payout.destination}
        </p>

        <p class="gm-caption">
          This is the only view that shows a payment destination, and opening it was
          recorded against your account.
        </p>

        {#if payout.externalReference}
          <p class="border-t border-border pt-3 text-sm">
            <span class="text-text-secondary">Paid under reference</span>
            <span class="font-mono font-medium text-text">{payout.externalReference}</span>
          </p>
        {/if}

        {#if payout.reviewReason}
          <p class="border-t border-border pt-3 text-sm">
            <span class="text-text-secondary">Reason on file</span>
            <span class="font-medium text-text">{payout.reviewReason}</span>
          </p>
        {/if}
      </Card>

      <ReviewContext context={payout.reviewContext} />
    </div>
  </div>
</div>
