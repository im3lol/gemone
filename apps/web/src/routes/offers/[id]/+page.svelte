<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head><title>{data.offer.title}</title></svelte:head>

<p><a href="/offers">← All offers</a></p>

<h1>{data.offer.title}</h1>

<p class="reward">{data.offer.rewardPoints} points</p>

{#if form?.message}
  <p class="error">{form.message}</p>
{/if}

{#if data.offer.description}
  <p>{data.offer.description}</p>
{/if}

{#if data.offer.requirements}
  <h2>What you need to do</h2>
  <p>{data.offer.requirements}</p>
{/if}

<form method="POST">
  <button type="submit">Start this offer</button>
</form>

<p class="notice">
  Points are credited after the provider confirms your completion, and become
  withdrawable once the hold period has passed.
</p>

<style>
  .reward {
    font-size: 1.4rem;
    font-weight: 600;
    color: #0a7;
  }
</style>
