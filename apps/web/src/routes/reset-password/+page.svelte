<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head><title>Choose a new password</title></svelte:head>

<h1>Choose a new password</h1>

{#if form?.done}
  <p class="notice">
    Your password has been changed and every session has been signed out.
  </p>
  <p><a href="/login">Log in</a></p>
{:else}
  {#if form?.message}
    <p class="error">{form.message}</p>
  {/if}

  <form method="POST">
    <input type="hidden" name="token" value={form?.token ?? data.token} />

    <label>
      New password
      <input name="password" type="password" autocomplete="new-password" minlength="12" required />
      <small>At least 12 characters.</small>
    </label>

    <button type="submit">Change my password</button>
  </form>
{/if}
