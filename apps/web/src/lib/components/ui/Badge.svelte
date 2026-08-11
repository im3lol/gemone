<!--
  Badge — DESIGN_SYSTEM.md §13.1, docs/UI_KIT.md.

  Legacy's only real UI primitive, reproduced with semantic variant names. The
  shape is the identity detail: `rounded-md`, `px-2 py-0.5`, `text-xs
  font-medium` — badges are the *least* round thing in the interface, a
  deliberate contrast against the pill buttons.

  The six semantic variants cover state. The three extended tones exist because
  legacy colour-codes offer categories and ledger types (DS §13.2) and those
  screens arrive in later phases; the enum→tone maps belong with those screens,
  not here.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    variant?:
      | 'neutral'
      | 'brand'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
      | 'purple'
      | 'indigo'
      | 'pink';
    class?: string;
    children?: Snippet;
  };

  let { variant = 'neutral', class: extra = '', children }: Props = $props();
</script>

<span class="gm-badge gm-badge--{variant} {extra}">
  {@render children?.()}
</span>
