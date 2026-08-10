<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>Register</title></svelte:head>

<h1>Create an account</h1>

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
    <input name="password" type="password" autocomplete="new-password" minlength="12" required />
    <small>At least 12 characters.</small>
  </label>

  <button type="submit">Register</button>
</form>

<p>Already registered? <a href="/login">Log in</a></p>
