<!--
  Sidebar — DESIGN_SYSTEM.md §14.2, §15.2.

  256px, white, a slate-100 right edge, sticky for the full viewport height, and
  **hidden below `lg`**. Hiding it is legacy's behaviour and is kept; what is
  not kept is legacy leaving nothing in its place (DS §22.3) — `MobileNav`
  carries the same items below 1024px.

  Item radius is `rounded-xl` (12px), deliberately one step tighter than the
  card's 16px. That difference is small and it is one of the things that makes
  the sidebar read as navigation rather than as a stack of cards.

  ## What is deliberately absent

  Legacy pins a "Get the app" promo card to the bottom with Play Store and App
  Store chips. There is no mobile app, so reproducing it would be advertising
  something that does not exist — the same objection UI_AUDIT.md N6 raises
  against legacy's invented marketing statistics.
-->
<script lang="ts">
  import { isActive, type NavGroup } from './nav';
  import Logo from './Logo.svelte';

  type Props = {
    groups: NavGroup[];
    pathname: string;
  };

  let { groups, pathname }: Props = $props();
</script>

<aside
  class="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface p-4 lg:flex"
>
  <a href="/dashboard" class="mb-4 inline-flex rounded-field px-3 py-2 hover:no-underline">
    <Logo />
  </a>

  <nav aria-label="Main" class="flex-1 overflow-y-auto">
    {#each groups as group, index (group.id)}
      {#if index > 0}
        <hr class="my-3 border-t border-border" />
      {/if}

      <ul class="flex flex-col gap-1">
        {#each group.items as item (item.href)}
          {@const active = isActive(pathname, item.href)}
          {@const Icon = item.icon}
          <li>
            <a
              href={item.href}
              aria-current={active ? 'page' : undefined}
              class="flex items-center gap-3 rounded-block px-3 py-2.5 text-sm font-medium transition hover:no-underline
                {active
                ? 'bg-brand-50 text-brand-700'
                : 'text-text-secondary hover:bg-surface-muted hover:text-[#1d293d]'}"
            >
              <Icon size={20} aria-hidden="true" class="shrink-0" />
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  </nav>
</aside>
