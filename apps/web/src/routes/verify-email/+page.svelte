<script lang="ts">
  let { data, form } = $props();

  let state = $derived(form?.state ?? data.state);
</script>

<svelte:head><title>Verify your email</title></svelte:head>

<h1>Verify your email</h1>

{#if state === 'verified'}
  <p class="notice">Your email address is confirmed.</p>
  <p><a href="/dashboard">Go to your dashboard</a></p>
{:else}
  {#if state === 'failed'}
    <p class="error">That link is invalid or has expired.</p>
  {/if}

  <form method="POST">
    <label>
      Verification token
      <input name="token" required />
    </label>
    <button type="submit">Verify</button>
  </form>
{/if}
