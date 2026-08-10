<script lang="ts">
  let { data, form } = $props();

  /*
   * The enabled methods are configuration (P3) and there is no public endpoint
   * that lists them, so this is the shipped default. An admin who enables
   * another method has to have this list updated too — recorded as a TODO.
   */
  const methods = ['paypal'];
</script>

<svelte:head><title>Payouts</title></svelte:head>

<h1>Payouts</h1>

<p>You have <strong>{data.balance.available}</strong> points available to withdraw.</p>

{#if form?.submitted}
  <p class="notice">Your request was received and is waiting for review.</p>
{/if}

{#if form?.message}
  <p class="error">{form.message}</p>
{/if}

<form method="POST">
  <label>
    Points
    <input name="amountPoints" type="number" min="1" required />
  </label>

  <label>
    Method
    <select name="method">
      {#each methods as method (method)}
        <option value={method}>{method}</option>
      {/each}
    </select>
  </label>

  <label>
    Destination
    <input name="destination" required placeholder="The account that receives the money" />
  </label>

  <button type="submit">Request payout</button>
</form>

<h2>Your requests</h2>

{#if data.payouts.items.length === 0}
  <p class="notice">No requests yet.</p>
{:else}
  <table>
    <thead>
      <tr><th>When</th><th>Points</th><th>To</th><th>Status</th></tr>
    </thead>
    <tbody>
      {#each data.payouts.items as payout (payout.id)}
        <tr>
          <td>{payout.createdAt.slice(0, 10)}</td>
          <td class="amount">{payout.amountPoints}</td>
          <td>{payout.method} · {payout.destinationMasked}</td>
          <td>
            {payout.status}
            {#if payout.reviewReason}<br /><small>{payout.reviewReason}</small>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid #eee;
    vertical-align: top;
  }

  .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
