<!--
  Ask for a reset link — ARCHITECTURE.md §8.3.

  Legacy has no such page, so the card is built from the §19 recipe rather than
  reproduced from a screenshot. Nothing here is invented beyond the copy: the
  frame, the field and the pill are the same ones `/login` uses.

  **The confirmation says the same thing whatever happened.** The action
  returns `sent: true` for an address with an account and for one without,
  because the API answers 204 to both on purpose (D76). The page must not be
  the thing that gives away the difference — see `+page.server.ts`.
-->
<script lang="ts">
  import { AuthCard } from '$lib/components/auth';
  import { Alert, Button, Input } from '$lib/components/ui';

  let { form } = $props();

  const sent = $derived(Boolean(form?.sent));
</script>

<svelte:head><title>Reset your password · GemOne</title></svelte:head>

<AuthCard
  title={sent ? 'Check your inbox' : 'Reset your password'}
  subtitle={sent ? undefined : "We'll email you a link to choose a new one."}
>
  {#if sent}
    <Alert variant="success">
      If that address has an account, a reset link is on its way. The link expires in an hour.
    </Alert>
  {:else}
    <form method="POST" class="flex flex-col gap-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        required
      />

      <Button type="submit" block>Send a reset link</Button>
    </form>
  {/if}

  {#snippet footer()}
    <a href="/login" class="font-semibold text-brand-600">Back to log in</a>
  {/snippet}
</AuthCard>
