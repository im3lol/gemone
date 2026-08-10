<script lang="ts">
  let { data, form } = $props();

  let payout = $derived(data.payout);
  let context = $derived(data.payout.reviewContext);
</script>

<svelte:head><title>Review payout</title></svelte:head>

<p><a href="/admin/payouts">← Payout queue</a></p>

<h1>{payout.amountPoints} points → {(payout.cashAmountMinor / 100).toFixed(2)} {payout.cashCurrency}</h1>

{#if form?.message}<p class="error">{form.message}</p>{/if}
{#if form?.done}<p class="notice">Recorded: {form.done}.</p>{/if}

<dl>
  <dt>Status</dt><dd>{payout.status}</dd>
  <dt>Method</dt><dd>{payout.method}</dd>
  <dt>Destination</dt><dd>{payout.destination}</dd>
  <dt>Requested</dt><dd>{payout.createdAt}</dd>
  {#if payout.externalReference}
    <dt>Reference</dt><dd>{payout.externalReference}</dd>
  {/if}
</dl>

<h2>The account</h2>

<dl>
  <dt>Member since</dt><dd>{context.accountCreatedAt.slice(0, 10)}</dd>
  <dt>Status</dt><dd>{context.accountStatus}</dd>
  <dt>Balance</dt>
  <dd>{context.balance.available} available · {context.balance.pending} pending · {context.balance.locked} locked</dd>
  <dt>Conversions</dt><dd>{context.conversionCount}</dd>
  <dt>Chargebacks</dt><dd>{context.chargebackCount}</dd>
  <dt>Paid before</dt><dd>{context.paidPayoutCount}</dd>
</dl>

{#if payout.status === 'PENDING_REVIEW'}
  <h2>Decide</h2>

  <form method="POST" action="?/approve">
    <label>Reason (optional)<input name="reason" /></label>
    <button type="submit">Approve</button>
  </form>

  <form method="POST" action="?/reject">
    <label>Reason<input name="reason" required /></label>
    <button type="submit">Reject</button>
  </form>
{:else if payout.status === 'APPROVED'}
  <h2>Record the payment</h2>

  <form method="POST" action="?/settle">
    <label>
      External reference
      <input name="externalReference" required placeholder="Bank reference or transaction id" />
    </label>
    <button type="submit">Mark paid</button>
  </form>
{/if}

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin-bottom: 1.5rem;
  }

  dt {
    font-weight: 600;
  }

  dd {
    margin: 0;
  }

  form {
    margin-bottom: 1rem;
  }
</style>
