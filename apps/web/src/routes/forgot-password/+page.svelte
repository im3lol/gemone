<script lang="ts">
  let { form } = $props();
</script>

<svelte:head><title>Reset your password</title></svelte:head>

<h1>Reset your password</h1>

{#if form?.sent}
  <p class="notice">
    If that address has an account, a reset link is on its way. The link expires
    in an hour.
  </p>
  <p><a href="/login">Back to log in</a></p>
{:else}
  <form method="POST">
    <label>
      Email
      <input name="email" type="email" autocomplete="email" required />
    </label>
    <button type="submit">Send a reset link</button>
  </form>
{/if}
