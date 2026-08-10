<script lang="ts">
  let { data } = $props();

  /*
   * Listed here rather than imported from `@gemone/contracts`: that package
   * compiles to CommonJS, so rollup cannot take its named runtime exports into
   * the browser bundle. These are filter labels — the API validates the value
   * and rejects anything it does not know, so a stale entry costs a filter, not
   * correctness.
   */
  const categories = ['GAME', 'SURVEY', 'SIGNUP', 'TRIAL', 'SHOPPING', 'APP_INSTALL', 'VIDEO', 'OTHER'];
  const sorts = ['reward_desc', 'reward_asc', 'newest'];

  let nextOffset = $derived(data.offset + data.pageSize);
  let prevOffset = $derived(Math.max(0, data.offset - data.pageSize));

  function pageLink(offset: number): string {
    const params = new URLSearchParams();
    if (data.filters.search) params.set('search', data.filters.search);
    if (data.filters.category) params.set('category', data.filters.category);
    if (data.filters.sort) params.set('sort', data.filters.sort);
    if (offset > 0) params.set('offset', String(offset));
    const query = params.toString();
    return query ? `/offers?${query}` : '/offers';
  }
</script>

<svelte:head><title>Offers</title></svelte:head>

<h1>Offers</h1>

<form method="GET" class="filters">
  <input name="search" placeholder="Search offers" value={data.filters.search} />

  <select name="category">
    <option value="">All categories</option>
    {#each categories as category (category)}
      <option value={category} selected={data.filters.category === category}>{category}</option>
    {/each}
  </select>

  <select name="sort">
    <option value="">Default</option>
    {#each sorts as sort (sort)}
      <option value={sort} selected={data.filters.sort === sort}>{sort}</option>
    {/each}
  </select>

  <button type="submit">Filter</button>
</form>

{#if data.page.items.length === 0}
  <p class="notice">No offers match. An admin must enable a provider before the wall fills.</p>
{:else}
  <ul class="offers">
    {#each data.page.items as offer (offer.id)}
      <li>
        <a href="/offers/{offer.id}">
          <strong>{offer.title}</strong>
          <span class="points">{offer.rewardPoints} points</span>
          <small>{offer.category} · {offer.providerSlug}</small>
        </a>
      </li>
    {/each}
  </ul>

  <nav class="pager">
    {#if data.offset > 0}<a href={pageLink(prevOffset)}>Previous</a>{/if}
    <span>{data.offset + 1}–{data.offset + data.page.items.length} of {data.page.total}</span>
    {#if nextOffset < data.page.total}<a href={pageLink(nextOffset)}>Next</a>{/if}
  </nav>
{/if}

<style>
  .filters {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .filters input,
  .filters select {
    width: auto;
    flex: 1 1 8rem;
    margin-top: 0;
  }

  .offers {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }

  .offers a {
    display: grid;
    gap: 0.2rem;
    padding: 0.9rem;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    background: #fff;
    text-decoration: none;
    color: inherit;
  }

  .points {
    font-variant-numeric: tabular-nums;
    color: #0a7;
    font-weight: 600;
  }

  small {
    color: #666;
  }

  .pager {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-top: 1.5rem;
  }
</style>
