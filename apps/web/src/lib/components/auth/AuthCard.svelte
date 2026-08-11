<!--
  AuthCard — DESIGN_SYSTEM.md §15.4 and §19.

  The centred card that every public authentication route renders into: gem,
  title, subtitle, the form, and a line of small print underneath.

  ## Why the mark lives here and not in a page header

  Phase 2 gave these routes a header bar with the logo pinned to the left while
  the form column sat centred below it — the "orphaned logo" the phase 2 review
  recorded. Legacy has no header on these pages at all: the mark is the first
  thing *inside* the card, centred above the title, and the card is centred in
  a tinted page. Moving it inside is what closes that gap, and it removes a
  layout band rather than adding one.

  The mark is still a link home. Legacy's is not — legacy has nowhere to go
  from `/login` — but now that `/` is a landing page, a logo that is not a way
  back to it is a dead end on the one screen where people arrive by accident.

  ## Structure

  Header and footer are centred; the form is not. Centring a column of labelled
  fields makes every label start at a different x-position, which is why the
  `children` region resets to `text-left`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import { Logo } from '$lib/components/shell';
  import { Card } from '$lib/components/ui';

  type Props = {
    title: string;
    subtitle?: string;
    /** The form, or whatever the route shows instead of one. */
    children: Snippet;
    /** Small print under the card body — the link to the other flow. */
    footer?: Snippet;
  };

  let { title, subtitle, children, footer }: Props = $props();
</script>

<Card as="section" padding="xl" class="w-full text-center">
  <a href="/" class="inline-flex hover:no-underline" aria-label="GemOne home">
    <Logo size="lg" wordmarkHidden />
  </a>

  <!--
    `text-2xl` and `font-bold`, not the `h1` default of `text-3xl`/`800`
    (DS §19). The auth card is 24rem wide and the page title recipe is sized
    for a full-width application header; at this width it wraps.
  -->
  <h1 class="mt-4 font-display text-2xl font-bold tracking-tight text-text">{title}</h1>

  {#if subtitle}
    <p class="mt-1 text-sm text-text-secondary">{subtitle}</p>
  {/if}

  <div class="mt-6 text-left">
    {@render children()}
  </div>

  {#if footer}
    <p class="mt-6 text-sm text-text-secondary">
      {@render footer()}
    </p>
  {/if}
</Card>
