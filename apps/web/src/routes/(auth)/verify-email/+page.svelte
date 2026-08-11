<!--
  Confirm an address — ARCHITECTURE.md §8.3.

  Three states in one card. Following a link from an email spends the token in
  `load` and lands on `verified`; the paste box exists because no email carries
  a link yet (TODO T67), and it is what makes the flow completable meanwhile.

  The failure is an `Alert`, not a replaced title: someone whose link expired
  needs the form still in front of them, and swapping the whole card for an
  error would make them navigate back to reach it.
-->
<script lang="ts">
  import { AuthCard } from '$lib/components/auth';
  import { Alert, Button, Input } from '$lib/components/ui';

  let { data, form } = $props();

  const state = $derived(form?.state ?? data.state);
</script>

<svelte:head><title>Verify your email · GemOne</title></svelte:head>

<AuthCard
  title={state === 'verified' ? "You're verified" : 'Verify your email'}
  subtitle={state === 'verified'
    ? undefined
    : 'Paste the token from your verification email to confirm this address.'}
>
  {#if state === 'verified'}
    <Alert variant="success" class="mb-6">Your email address is confirmed.</Alert>

    <Button href="/dashboard" block>Go to your dashboard</Button>
  {:else}
    {#if state === 'failed'}
      <Alert variant="error" class="mb-4">That link is invalid or has expired.</Alert>
    {/if}

    <form method="POST" class="flex flex-col gap-4">
      <Input label="Verification token" name="token" autocomplete="one-time-code" required />

      <Button type="submit" block>Verify</Button>
    </form>
  {/if}

  {#snippet footer()}
    <a href="/login" class="font-semibold text-brand-600">Back to log in</a>
  {/snippet}
</AuthCard>
