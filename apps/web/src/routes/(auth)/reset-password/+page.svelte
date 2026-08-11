<!--
  Set a new password from a reset token — ARCHITECTURE.md §8.2, §8.3.

  Not in the phase 3 brief's list, and rebuilt anyway: it shares the `(auth)`
  layout with the four pages that were, so leaving it on element defaults would
  have put an unstyled form inside the new tinted page. It is the same card
  with one field.

  **No session is issued on success** — the API deliberately does not (D76),
  and every other session was signed out, so the only thing this page can offer
  afterwards is the login form.
-->
<script lang="ts">
  import { AuthCard } from '$lib/components/auth';
  import { Alert, Button, Input } from '$lib/components/ui';

  let { data, form } = $props();

  const done = $derived(Boolean(form?.done));
</script>

<svelte:head><title>Choose a new password · GemOne</title></svelte:head>

<AuthCard
  title={done ? 'Password changed' : 'Choose a new password'}
  subtitle={done ? undefined : 'It replaces the old one everywhere you are signed in.'}
>
  {#if done}
    <Alert variant="success">
      Your password has been changed and every session has been signed out.
    </Alert>
  {:else}
    {#if form?.message}
      <Alert variant="error" class="mb-4">{form.message}</Alert>
    {/if}

    <form method="POST" class="flex flex-col gap-4">
      <input type="hidden" name="token" value={form?.token ?? data.token} />

      <Input
        label="New password"
        name="password"
        type="password"
        autocomplete="new-password"
        placeholder="••••••••"
        minlength={12}
        hint="At least 12 characters."
        required
      />

      <Button type="submit" block>Change my password</Button>
    </form>
  {/if}

  {#snippet footer()}
    <a href="/login" class="font-semibold text-brand-600">
      {done ? 'Log in' : 'Back to log in'}
    </a>
  {/snippet}
</AuthCard>
