<!--
  Topbar — DESIGN_SYSTEM.md §14.3.

  Right-aligned, no border, no background, and **no page title**: the title
  lives in the page body (§15.2), which is why this bar can be one row of
  controls rather than a header that every page has to feed.

  Below `lg` it also carries the logo on the left, because the sidebar that
  normally holds it is hidden there. Without that, a phone would have no way
  back to the dashboard from a detail page and no visible logout.

  ## What is deliberately absent

  Legacy's bar starts with a Gift button (daily bonus) and a Bell (notifications).
  Neither feature exists in this application, and a button that opens nothing is
  the defect UI_AUDIT.md §9 records against legacy's admin sidebar. They arrive
  with their features or not at all.

  ## The identity pill

  Reproduced from §14.3 — the emoji avatar on a slate circle, the name, and the
  balance in `brand-600` prefixed with the literal ◈ (U+25C8). One departure:
  `UserProfile` carries no display name, so the pill shows the email's local
  part. The full address is still announced, so nothing is hidden from a screen
  reader that a sighted user can see.
-->
<script lang="ts">
  import LogOut from '@lucide/svelte/icons/log-out';

  import { Button } from '$lib/components/ui';

  import Logo from './Logo.svelte';

  type Props = {
    email: string;
    /** Withdrawable points. `null` when the balance call failed — see below. */
    availablePoints: number | null;
  };

  let { email, availablePoints }: Props = $props();

  const name = $derived(email.split('@')[0]);

  /*
   * Pinned to `en-US` rather than the visitor's locale. An unpinned
   * `toLocaleString()` formats with the server's locale during SSR and the
   * browser's during hydration, and the two disagree on thousands separators —
   * a hydration mismatch that shows up as a number flickering on first paint.
   */
  const balance = $derived(availablePoints?.toLocaleString('en-US') ?? null);
</script>

<div class="flex items-center justify-between gap-4 py-3 lg:justify-end">
  <a href="/dashboard" class="inline-flex hover:no-underline lg:hidden">
    <Logo />
  </a>

  <div class="flex min-w-0 items-center gap-2">
    <div
      class="flex min-w-0 items-center gap-3 rounded-control border border-border py-1 pr-3 pl-1"
    >
      <span
        aria-hidden="true"
        class="grid size-9 shrink-0 place-items-center rounded-control bg-border-strong text-lg"
      >
        🙂
      </span>

      <span class="min-w-0">
        <span class="block truncate text-sm font-semibold text-text">{name}</span>
        {#if balance !== null}
          <span class="block text-xs font-medium text-brand-600">
            <span aria-hidden="true">◈</span>
            {balance}<span class="gm-sr-only"> points available</span>
          </span>
        {/if}
      </span>

      <span class="gm-sr-only">Signed in as {email}</span>
    </div>

    <!--
      The logout form is unchanged: still a POST to `/logout`, because a logout
      reachable by GET is a logout any image tag can trigger. Only its button
      became an icon.
    -->
    <form method="POST" action="/logout">
      <Button type="submit" variant="ghost" iconOnly aria-label="Log out">
        <LogOut size={20} aria-hidden="true" />
      </Button>
    </form>
  </div>
</div>
