<!--
  MobileNav — the fix for legacy's clearest defect.

  DESIGN_SYSTEM.md §22.3: below 1024px legacy has **no navigation at all**. Both
  sidebars are `hidden … lg:flex` with no substitute, the `Menu` icon in the
  admin header has no handler, and every authenticated page is reachable only by
  typing its URL. That is flagged in the design system as *"fix, don't copy"*.

  ## Where the design comes from

  Not invented. Legacy's own hero mockup shows what the mobile navigation was
  meant to be — a bottom bar of `Home · Earn · Wallet · Profile`, the active
  item in `font-semibold text-brand-600` and the rest in `text-slate-400`,
  separated by `border-t border-slate-100` at `text-[10px]` (DS §22.3). That is
  reproduced here with this application's own routes.

  ## Why a bottom bar rather than a drawer

  A drawer is a button that hides a menu; a bar is the menu. With four or five
  destinations there is nothing to hide, and every item stays one thumb-reach
  away with no state to open, close, trap focus in, or get stuck.

  Sidebar and bar are never exposed at the same time: each is `display: none` at
  the other's breakpoint, which removes it from the accessibility tree too, so
  both can carry the same landmark label without ambiguity.
-->
<script lang="ts">
  import { isActive, type NavItem } from './nav';

  type Props = {
    items: NavItem[];
    pathname: string;
  };

  let { items, pathname }: Props = $props();
</script>

<nav
  aria-label="Main"
  class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
>
  <ul class="flex items-stretch">
    {#each items as item (item.href)}
      {@const active = isActive(pathname, item.href)}
      {@const Icon = item.icon}
      <li class="min-w-0 flex-1">
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class="flex flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-[10px] transition hover:no-underline
            {active ? 'font-semibold text-brand-600' : 'font-medium text-text-muted'}"
        >
          <Icon size={20} aria-hidden="true" class="shrink-0" />
          <span class="w-full truncate text-center">{item.shortLabel}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>
