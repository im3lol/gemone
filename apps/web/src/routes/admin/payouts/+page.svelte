<script lang="ts">
  let { data } = $props();

  const statuses = ['PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'FAILED'];
</script>

<svelte:head><title>Payout queue</title></svelte:head>

<h1>Payout queue</h1>

<nav class="tabs">
  {#each statuses as status (status)}
    <a href="/admin/payouts?status={status}" class:active={data.status === status}>{status}</a>
  {/each}
</nav>

{#if data.page.items.length === 0}
  <p class="notice">Nothing in this queue.</p>
{:else}
  <table>
    <thead>
      <tr><th>When</th><th>Points</th><th>Cash</th><th>Method</th><th></th></tr>
    </thead>
    <tbody>
      {#each data.page.items as payout (payout.id)}
        <tr>
          <td>{payout.createdAt.slice(0, 10)}</td>
          <td class="amount">{payout.amountPoints}</td>
          <td class="amount">{(payout.cashAmountMinor / 100).toFixed(2)} {payout.cashCurrency}</td>
          <td>{payout.method}</td>
          <td><a href="/admin/payouts/{payout.id}">Review</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .tabs {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .tabs .active {
    font-weight: 600;
    text-decoration: none;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid #eee;
  }

  .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
