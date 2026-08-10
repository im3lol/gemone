<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Dashboard</title></svelte:head>

<h1>Dashboard</h1>

<dl>
  <dt>Email</dt>
  <dd>{data.profile.email}</dd>

  <dt>Status</dt>
  <dd>{data.profile.status}</dd>

  <dt>Member since</dt>
  <dd>{data.profile.createdAt.slice(0, 10)}</dd>
</dl>

<p class="notice">
  Offers and balances arrive in later milestones. This page exists to prove the
  session works end to end.
</p>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1rem;
    margin-bottom: 2rem;
  }

  dt {
    font-weight: 600;
  }

  dd {
    margin: 0;
  }
</style>
