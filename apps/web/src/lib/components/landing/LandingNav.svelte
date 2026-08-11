<!--
  The public header — DESIGN_SYSTEM.md §18.3.

  ```
  header  sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur
  inner   flex h-16 items-center justify-between
  ```

  64px tall, translucent, blurred — the only blurred surface in the product,
  and the reason content visibly slides under it as the page scrolls.

  ## The mobile menu legacy does not have

  Legacy hides the nav links below `md` and "Log in" below `sm`, leaving a 390px
  header of logo + "Sign up" and **no way to reach any section** (DS §18.3,
  §22.3 — the same gap the app had before phase 2). A disclosure button is added
  here instead of reproducing it:

  - a real `<button>` with `aria-expanded` and `aria-controls`, so the state is
    announced rather than implied by an icon;
  - Escape closes it, because a panel that only closes by hitting the same
    small target again is a trap for anyone not using a mouse;
  - choosing a link closes it, since every link is an in-page anchor and the
    panel would otherwise cover what it just scrolled to.

  The panel is not a modal: it pushes the page down rather than covering it, so
  there is no focus trap to get wrong and no scroll lock to leak.
-->
<script lang="ts">
  import Menu from '@lucide/svelte/icons/menu';
  import X from '@lucide/svelte/icons/x';

  import { Logo } from '$lib/components/shell';
  import { Button, Container } from '$lib/components/ui';

  import { NAV_LINKS } from './content';

  type Props = {
    /** Swaps the sign-up pair for a way back into the app. */
    authenticated: boolean;
  };

  let { authenticated }: Props = $props();

  let open = $state(false);
</script>

<svelte:window
  onkeydown={(event) => {
    if (open && event.key === 'Escape') open = false;
  }}
/>

<header class="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
  <Container class="flex h-16 items-center justify-between gap-4">
    <a href="/" class="inline-flex hover:no-underline" aria-label="GemOne home">
      <Logo />
    </a>

    <nav aria-label="Page sections" class="hidden items-center gap-7 md:flex">
      {#each NAV_LINKS as link (link.href)}
        <a
          href={link.href}
          class="text-sm font-medium text-text-body transition-colors hover:text-text hover:no-underline"
        >
          {link.label}
        </a>
      {/each}
    </nav>

    <div class="flex items-center gap-3">
      <!--
        The default size is `0.625rem 1.25rem` at `0.875rem` — DS §18.3's
        `px-5 py-2 text-sm` header pill, to within the half-step the kit rounds
        to. `sm` would be the `text-xs` table-row button, which is not this.
      -->
      {#if authenticated}
        <Button href="/dashboard">Go to your dashboard</Button>
      {:else}
        <a
          href="/login"
          class="hidden text-sm font-medium text-text-body hover:text-text hover:no-underline sm:block"
        >
          Log in
        </a>
        <Button href="/register">Sign up</Button>
      {/if}

      <!-- Default size, not `sm`: an icon-only `sm` is 32px, under the 40px
           minimum touch target this control exists to serve (DS §9.6). -->
      <Button
        variant="ghost"
        iconOnly
        class="md:hidden"
        aria-expanded={open}
        aria-controls="landing-menu"
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        onclick={() => (open = !open)}
      >
        {#if open}
          <X size={20} aria-hidden="true" />
        {:else}
          <Menu size={20} aria-hidden="true" />
        {/if}
      </Button>
    </div>
  </Container>

  {#if open}
    <nav id="landing-menu" aria-label="Page sections" class="border-t border-border md:hidden">
      <Container>
        <ul class="flex flex-col py-2">
          {#each NAV_LINKS as link (link.href)}
            <li>
              <a
                href={link.href}
                onclick={() => (open = false)}
                class="block rounded-block px-2 py-2.5 text-sm font-medium text-text-body hover:bg-surface-muted hover:text-text hover:no-underline"
              >
                {link.label}
              </a>
            </li>
          {/each}

          {#if !authenticated}
            <li class="sm:hidden">
              <a
                href="/login"
                class="block rounded-block px-2 py-2.5 text-sm font-medium text-text-body hover:bg-surface-muted hover:text-text hover:no-underline"
              >
                Log in
              </a>
            </li>
          {/if}
        </ul>
      </Container>
    </nav>
  {/if}
</header>
