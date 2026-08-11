<!--
  Card — DESIGN_SYSTEM.md §11.1, docs/UI_KIT.md.

  White surface, slate-100 hairline, `shadow-sm`, 16px radius. Legacy uses this
  exact combination on thirty surfaces and it is the substrate of every screen
  (DS §23.1); most of the product's visual identity is this one rule.

  `as` exists because a card is often a `<section>`, an `<li>` or an `<article>`
  rather than a `<div>`, and the choice is a semantics decision the caller owns.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = {
    /** `sm` 1rem · `md` 1.25rem (default) · `lg` 1.5rem · `xl` 2rem · `none`. */
    padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
    /** Drop the shadow — for cards nested inside another surface. */
    flat?: boolean;
    /** Hover lift. Legacy uses it on offer cards only (DS §8). */
    interactive?: boolean;
    as?: 'div' | 'section' | 'article' | 'li';
    class?: string;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLElement>, 'class' | 'children'>;

  let {
    padding = 'md',
    flat = false,
    interactive = false,
    as = 'div',
    class: extra = '',
    children,
    ...rest
  }: Props = $props();

  const classes = $derived(
    [
      'gm-card',
      padding !== 'md' && `gm-card--pad-${padding}`,
      flat && 'gm-card--flat',
      interactive && 'gm-card--interactive',
      extra,
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<svelte:element this={as} class={classes} {...rest}>
  {@render children?.()}
</svelte:element>
