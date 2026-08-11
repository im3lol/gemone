<!--
  Register — DESIGN_SYSTEM.md §19.

  Copy is legacy's: "Create your account" / "Start earning rewards in
  seconds." / "Already have an account? Log in".

  ## Two things legacy's signup card has that this one does not

  **A "Display name" field.** `POST /auth/register` takes an email and a
  password; there is no name on the account to send one to. A field whose value
  is discarded is worse than a missing field.

  **The referral banner** (`/signup?ref=CODE`, "🎁 You were invited! You'll
  both start earning together."). Referrals are not built — the request carries
  no referral code and nothing would credit an inviter. Rendering the banner
  would be a promise the system cannot keep. Recorded as TODO T75.

  The minimum length is **12**, not legacy's 8, because that is what the API
  enforces (ARCHITECTURE.md §8.2). `minlength` here only saves a round trip;
  the API is the thing that decides.
-->
<script lang="ts">
  import { AuthCard } from '$lib/components/auth';
  import { Alert, Button, Input } from '$lib/components/ui';

  let { form } = $props();
</script>

<svelte:head><title>Create your account · GemOne</title></svelte:head>

<AuthCard title="Create your account" subtitle="Start earning rewards in seconds.">
  {#if form?.message}
    <Alert variant="error" class="mb-4">{form.message}</Alert>
  {/if}

  <form method="POST" class="flex flex-col gap-4">
    <Input
      label="Email"
      name="email"
      type="email"
      autocomplete="email"
      placeholder="you@example.com"
      required
      value={form?.email ?? ''}
    />

    <Input
      label="Password"
      name="password"
      type="password"
      autocomplete="new-password"
      placeholder="••••••••"
      minlength={12}
      hint="At least 12 characters."
      required
    />

    <Button type="submit" block>Sign up</Button>
  </form>

  {#snippet footer()}
    Already have an account? <a href="/login" class="font-semibold text-brand-600">Log in</a>
  {/snippet}
</AuthCard>
