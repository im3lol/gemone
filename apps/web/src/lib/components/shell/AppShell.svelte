<!--
  AppShell — DESIGN_SYSTEM.md §15.2.

  ```
  flex min-h-screen bg-slate-50
    ├─ Sidebar          256px, lg and up
    └─ content column   Topbar → page → (MobileNav, below lg)
  ```

  **The app background is `slate-50` while cards are white.** That single
  contrast is what makes the app feel layered despite near-zero shadow, and it
  is the substrate of every authenticated screen (DS §23.1).

  ## Width

  The content column has no maximum width, matching legacy: the sidebar is what
  bounds it, and the page's own components decide how wide their content should
  be. Horizontal padding steps `1rem → 1.5rem → 2rem` through `.gm-container`,
  which is legacy's `px-4 sm:px-6 lg:px-8`.

  ## The skip link

  First focusable element on the page, visible only when focused. Without it,
  reaching a page's content by keyboard means tabbing past every navigation item
  on every navigation — the sort of thing that is invisible to anyone testing
  with a mouse, which is why legacy has none.

  **`tabindex="-1"` on the target is what makes it work.** A fragment link moves
  the scroll position, but focus only follows if the destination can hold it,
  and `<main>` cannot by default. Without the attribute the link looks correct,
  updates the URL to `#main`, and leaves focus on `<body>` — so the next Tab
  goes back to the skip link and the whole thing is decoration. Measured, not
  assumed: that is exactly what it did before this was added.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { UserRole } from '@gemone/contracts';

  import MobileNav from './MobileNav.svelte';
  import Sidebar from './Sidebar.svelte';
  import Topbar from './Topbar.svelte';
  import { navGroups, navItems } from './nav';

  type Props = {
    pathname: string;
    email: string;
    role: UserRole;
    availablePoints: number | null;
    children: Snippet;
  };

  let { pathname, email, role, availablePoints, children }: Props = $props();

  const groups = $derived(navGroups(role));
  const items = $derived(navItems(role));
</script>

<a
  href="#main"
  class="gm-btn gm-btn--primary gm-btn--sm sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
>
  Skip to content
</a>

<div class="flex min-h-screen bg-background">
  <Sidebar {groups} {pathname} />

  <div class="flex min-w-0 flex-1 flex-col">
    <div class="gm-container gm-container--full">
      <Topbar {email} {availablePoints} />
    </div>

    <!--
      `pb-24` below `lg` clears the fixed bottom bar. Without it the last row of
      any page sits underneath the navigation and cannot be scrolled into view —
      the standard bottom-bar bug, and the reason the padding lives here rather
      than in each page.
    -->
    <main
      id="main"
      tabindex="-1"
      class="gm-container gm-container--full gm-legacy-flow flex-1 pt-2 pb-24 lg:pb-10"
    >
      {@render children()}
    </main>
  </div>
</div>

<MobileNav {items} {pathname} />
