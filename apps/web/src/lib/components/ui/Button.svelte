<!--
  Button — DESIGN_SYSTEM.md §9, docs/UI_KIT.md.

  One silhouette, five variants. Renders an `<a>` when `href` is given and a
  real `<button>` otherwise, because a link that is styled as a button must
  still be a link: middle-click, "open in new tab" and the browser's own focus
  order all depend on it.

  `loading` disables the control and marks it `aria-busy`. It keeps the label
  visible rather than swapping the text the way legacy does (DS §9.7) — a label
  that changes width makes the row reflow under the pointer mid-click.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  import Spinner from './Spinner.svelte';

  type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  type Size = 'sm' | 'md' | 'lg';

  type Props = {
    variant?: Variant;
    size?: Size;
    /** Square target with no label. Requires `aria-label` on the caller. */
    iconOnly?: boolean;
    /** Stretch to the width of the form — the full-width submit in DS §9.1. */
    block?: boolean;
    loading?: boolean;
    disabled?: boolean;
    href?: string;
    type?: HTMLButtonAttributes['type'];
    class?: string;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes, 'type' | 'disabled' | 'class'> &
    Omit<HTMLAnchorAttributes, 'href' | 'type' | 'class'>;

  let {
    variant = 'primary',
    size = 'md',
    iconOnly = false,
    block = false,
    loading = false,
    disabled = false,
    href,
    type = 'button',
    class: extra = '',
    children,
    ...rest
  }: Props = $props();

  const classes = $derived(
    [
      'gm-btn',
      `gm-btn--${variant}`,
      size !== 'md' && `gm-btn--${size}`,
      iconOnly && 'gm-btn--icon',
      block && 'gm-btn--block',
      extra,
    ]
      .filter(Boolean)
      .join(' '),
  );

  const inactive = $derived(disabled || loading);
</script>

{#if href}
  <!--
    A disabled link has no HTML equivalent, so the href is dropped and
    `aria-disabled` carries the meaning. Dropping it is what actually stops
    activation; the attribute alone would only announce it.
  -->
  <a
    href={inactive ? undefined : href}
    aria-disabled={inactive ? 'true' : undefined}
    aria-busy={loading ? 'true' : undefined}
    tabindex={inactive ? -1 : undefined}
    class={classes}
    {...rest}
  >
    {#if loading}<Spinner size={size === 'lg' ? 'md' : 'sm'} />{/if}
    {@render children?.()}
  </a>
{:else}
  <button {type} disabled={inactive} aria-busy={loading ? 'true' : undefined} class={classes} {...rest}>
    {#if loading}<Spinner size={size === 'lg' ? 'md' : 'sm'} />{/if}
    {@render children?.()}
  </button>
{/if}
