<!--
  Log in — DESIGN_SYSTEM.md §19.

  Copy is legacy's, verbatim: "Welcome back" / "Log in to continue earning." /
  "New to GemOne? Create one".

  **The form posts to the current URL, query string included.** That is how
  `?next=` survives the round trip to the action, which is what sends someone
  back to the page they were trying to reach (see `+page.server.ts`). Giving
  the form an explicit `action="/login"` would silently drop it.
-->
<script lang="ts">
  import { AuthCard } from '$lib/components/auth';
  import { Alert, Button, Input } from '$lib/components/ui';

  let { form } = $props();
</script>

<svelte:head><title>Log in · GemOne</title></svelte:head>

<AuthCard title="Welcome back" subtitle="Log in to continue earning.">
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
      autocomplete="current-password"
      placeholder="••••••••"
      required
    />

    <Button type="submit" block>Log in</Button>
  </form>

  <!--
    Legacy has no reset link — and no reset flow behind one. This product does
    (ARCHITECTURE.md §8.3), and a password form with no way out of a forgotten
    password is a dead end, so the link is added below the submit where it does
    not compete with it.
  -->
  <p class="mt-4 text-center text-sm">
    <a href="/forgot-password" class="text-text-secondary hover:text-text">
      Forgotten your password?
    </a>
  </p>

  {#snippet footer()}
    New to GemOne? <a href="/register" class="font-semibold text-brand-600">Create one</a>
  {/snippet}
</AuthCard>
