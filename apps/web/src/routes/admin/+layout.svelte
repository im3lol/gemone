<!--
  A holding layout for the admin screens — **not** the admin shell.

  DESIGN_SYSTEM.md §14.4–14.5 and §15.3 specify a real one: a 240px sidebar with
  five titled groups, a bordered topbar with a search field, its own item radius.
  That is phase 7, and it arrives with the screens it navigates to — there is no
  point building a sidebar whose links all lead to pages that do not exist yet
  (UI_AUDIT.md AD1).

  What this file does is keep the two admin pages from losing what they already
  had when the root layout stopped drawing a header: a way back to the
  application and a way to log out. It uses the `wide` container because an
  admin queue is a table, and the 34rem column phase 1 removed was worst here.
-->
<script lang="ts">
  import { page } from '$app/state';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import LogOut from '@lucide/svelte/icons/log-out';

  import { Logo } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';

  let { children } = $props();

  /**
   * The admin screens that exist. Five, and the list grows with them — a
   * five-group sidebar whose links lead to pages that do not exist is worse
   * than none (UI_AUDIT.md AD1).
   */
  const SECTIONS = [
    { href: '/admin/payouts', label: 'Payouts' },
    { href: '/admin/fraud', label: 'Fraud' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/providers', label: 'Providers' },
    { href: '/admin/settings', label: 'Settings' },
  ];
</script>

<div class="flex min-h-screen flex-col bg-background">
  <header class="border-b border-border bg-surface">
    <div class="gm-container gm-container--wide flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <a href="/dashboard" class="inline-flex hover:no-underline">
        <Logo />
      </a>
      <span class="gm-badge gm-badge--neutral">Admin</span>

      <!--
        One link per screen that exists. This is not the sidebar DS §14.4
        specifies and does not pretend to be; it grows into one when there are
        enough screens to navigate.
      -->
      <nav aria-label="Admin sections" class="ml-2 flex flex-wrap gap-1">
        {#each SECTIONS as section (section.href)}
          {@const active = page.url.pathname.startsWith(section.href)}
          <a
            href={section.href}
            aria-current={active ? 'page' : undefined}
            class="gm-btn gm-btn--sm {active ? 'gm-btn--secondary' : 'gm-btn--ghost'}"
          >
            {section.label}
          </a>
        {/each}
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <Button href="/dashboard" variant="ghost" size="sm">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to app
        </Button>

        <form method="POST" action="/logout">
          <Button type="submit" variant="ghost" iconOnly aria-label="Log out">
            <LogOut size={20} aria-hidden="true" />
          </Button>
        </form>
      </div>
    </div>
  </header>

  <main id="main" class="gm-container gm-container--wide gm-legacy-flow flex-1 py-8">
    {@render children()}
  </main>
</div>
