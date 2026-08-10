<script lang="ts">
  let { data, children } = $props();
</script>

<header>
  <a href="/" class="brand">gemone</a>
  <nav>
    {#if data.isAuthenticated}
      <a href="/offers">Offers</a>
      <a href="/earnings">Earnings</a>
      <a href="/payouts">Payouts</a>
      <a href="/dashboard">Dashboard</a>
      <form method="POST" action="/logout">
        <button type="submit" class="link">Log out</button>
      </form>
    {:else}
      <a href="/login">Log in</a>
      <a href="/register">Register</a>
    {/if}
  </nav>
</header>

<main>
  {@render children()}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
    color: #111;
    background: #fafafa;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e5e5e5;
    background: #fff;
  }

  .brand {
    font-weight: 600;
    text-decoration: none;
    color: inherit;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  nav form {
    display: inline;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #0645ad;
    text-decoration: underline;
    cursor: pointer;
  }

  main {
    max-width: 34rem;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  :global(label) {
    display: block;
    margin-bottom: 1rem;
  }

  :global(input) {
    display: block;
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.25rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
    box-sizing: border-box;
  }

  :global(button[type='submit']:not(.link)) {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 4px;
    background: #111;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }

  :global(.error) {
    padding: 0.75rem;
    margin-bottom: 1rem;
    border: 1px solid #d33;
    border-radius: 4px;
    background: #fff5f5;
    color: #900;
  }

  :global(.notice) {
    padding: 0.75rem;
    margin-bottom: 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    background: #f8fafc;
  }
</style>
