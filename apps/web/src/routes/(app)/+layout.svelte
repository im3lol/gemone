<!--
  The authenticated application — DESIGN_SYSTEM.md §15.2.

  `(app)` is a SvelteKit route group: it wraps `/dashboard`, `/offers`,
  `/earnings` and `/payouts` in the shell **without appearing in any URL**. That
  matters twice over — every existing link keeps working, and
  `hooks.server.ts`'s `PROTECTED_PREFIXES` still names the same paths, so
  nothing about who may reach these pages has changed.

  It also replaces the pathname lookup that phase 1 left in the root layout as a
  stopgap. Which shell a route gets is now a property of where the route lives.
-->
<script lang="ts">
  import { page } from '$app/state';

  import { AppShell } from '$lib/components/shell';

  let { data, children } = $props();
</script>

<AppShell
  pathname={page.url.pathname}
  email={data.profile.email}
  role={data.profile.role}
  availablePoints={data.balance?.available ?? null}
>
  {@render children()}
</AppShell>
