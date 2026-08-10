<script lang="ts">
  let { data } = $props();

  let nextOffset = $derived(data.offset + data.pageSize);
</script>

<svelte:head><title>Earnings</title></svelte:head>

<h1>Earnings</h1>

<!-- Three buckets, never one number: showing a single total tells people they
     can withdraw points still inside their hold period. -->
<ul class="buckets">
  <li><span>Available</span><strong>{data.balance.available}</strong></li>
  <li><span>Pending</span><strong>{data.balance.pending}</strong></li>
  <li><span>Locked</span><strong>{data.balance.locked}</strong></li>
</ul>

<p><a href="/payouts">Request a payout</a></p>

<h2>Statement</h2>

{#if data.history.items.length === 0}
  <p class="notice">Nothing yet. Complete an offer and it appears here.</p>
{:else}
  <table>
    <thead>
      <tr><th>When</th><th>What</th><th>Points</th></tr>
    </thead>
    <tbody>
      {#each data.history.items as row (row.id)}
        <tr>
          <td>{row.createdAt.slice(0, 10)}</td>
          <td>{row.type}</td>
          <td class="amount">{row.amountPoints > 0 ? '+' : ''}{row.amountPoints}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <nav class="pager">
    {#if data.offset > 0}
      <a href="/earnings?offset={Math.max(0, data.offset - data.pageSize)}">Previous</a>
    {/if}
    {#if nextOffset < data.history.total}<a href="/earnings?offset={nextOffset}">Next</a>{/if}
  </nav>
{/if}

<style>
  .buckets {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .buckets li {
    flex: 1;
    padding: 0.9rem;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    background: #fff;
    display: grid;
    gap: 0.2rem;
  }

  .buckets span {
    color: #666;
    font-size: 0.85rem;
  }

  .buckets strong {
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
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

  .pager {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
  }
</style>
