<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>Log in</title></svelte:head>

<h1>Log in</h1>

{#if form?.message}
  <p class="error">{form.message}</p>
{/if}

<form method="POST">
  <label>
    Email
    <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
  </label>

  <label>
    Password
    <input name="password" type="password" autocomplete="current-password" required />
  </label>

  <button type="submit">Log in</button>
</form>

<p><a href="/forgot-password">Forgotten your password?</a></p>
<p>No account yet? <a href="/register">Register</a></p>
