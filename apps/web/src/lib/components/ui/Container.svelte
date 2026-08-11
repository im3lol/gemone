<!--
  Container — DESIGN_SYSTEM.md §5.3–5.4, docs/UI_KIT.md.

  The replacement for `main { max-width: 34rem }`, which put a 544px column
  under every screen in the application including tables, offer grids and the
  admin payout queue (UI_AUDIT.md S4). Width is now a decision each surface
  makes, from four named options, instead of a constant nobody could override.

    form    24rem   auth cards, single-field flows
    narrow  48rem   legal pages and prose
    page    72rem   the default — every landing and app section in legacy
    wide    96rem   admin tables and wide data views
    full    none    full-bleed sections that manage their own inner width

  Horizontal padding steps 1rem → 1.5rem → 2rem at `sm` and `lg`, matching
  legacy's `px-4 sm:px-6 lg:px-8`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = {
    size?: 'form' | 'narrow' | 'page' | 'wide' | 'full';
    as?: 'div' | 'main' | 'section' | 'header' | 'footer';
    class?: string;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLElement>, 'class' | 'children'>;

  let { size = 'page', as = 'div', class: extra = '', children, ...rest }: Props = $props();

  const classes = $derived(
    ['gm-container', size !== 'page' && `gm-container--${size}`, extra].filter(Boolean).join(' '),
  );
</script>

<svelte:element this={as} class={classes} {...rest}>
  {@render children?.()}
</svelte:element>
