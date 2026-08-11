<!--
  Spinner — docs/UI_KIT.md.

  Legacy has no spinner at all (DESIGN_SYSTEM.md §25.8); this is designed from
  the token layer. It inherits `currentColor`, so it is the right colour inside
  a brand button, a ghost button and a page alike without a variant prop.

  Decorative by default: `aria-hidden`, with the announcement left to whatever
  it sits inside (`aria-busy` on the button, `role="status"` on a page). Pass a
  `label` only when the spinner is the *only* thing on screen.
-->
<script lang="ts">
  type Props = {
    size?: 'sm' | 'md' | 'lg';
    /** Announced to assistive technology. Omit when a parent already says it. */
    label?: string;
    class?: string;
  };

  let { size = 'md', label, class: extra = '' }: Props = $props();

  const dimension = { sm: '0.875rem', md: '1rem', lg: '1.5rem' };
</script>

{#if label}
  <span role="status" class={extra}>
    <span class="gm-spinner" style:width={dimension[size]} style:height={dimension[size]}></span>
    <span class="gm-sr-only">{label}</span>
  </span>
{:else}
  <span
    aria-hidden="true"
    class="gm-spinner {extra}"
    style:width={dimension[size]}
    style:height={dimension[size]}
  ></span>
{/if}
