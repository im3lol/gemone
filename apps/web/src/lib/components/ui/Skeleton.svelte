<!--
  Skeleton — docs/UI_KIT.md, UI_AUDIT.md U3.

  A placeholder block that holds the space its content will occupy. Legacy has
  none (DESIGN_SYSTEM.md §25.8); this is designed from the token layer.

  ## Why it is hidden from assistive technology

  `aria-hidden`. A screen reader gains nothing from "blank, blank, blank" while
  a list loads — the announcement belongs on the region that is loading, as
  `aria-busy="true"`, which says one useful thing instead of ten useless ones.

  The pulse is opacity-only and stops entirely under `prefers-reduced-motion`.
-->
<script lang="ts">
  type Props = {
    /** Any CSS length. Defaults to the full width of the parent. */
    width?: string;
    height?: string;
    /** `text` uses the field radius, `circle` a pill, `block` the card radius. */
    shape?: 'text' | 'block' | 'circle';
    /** Repeat count, with the last line shortened the way real text ends. */
    lines?: number;
    class?: string;
  };

  let { width = '100%', height = '1rem', shape = 'text', lines = 1, class: extra = '' }: Props = $props();

  const radius = {
    text: 'rounded-field',
    block: 'rounded-card',
    circle: 'rounded-control',
  };
</script>

{#if lines > 1}
  <div class="flex flex-col gap-2 {extra}" aria-hidden="true">
    {#each Array.from({ length: lines }, (_, index) => index) as line (line)}
      <span
        class="gm-skeleton {radius[shape]}"
        style:width={line === lines - 1 ? '60%' : width}
        style:height
      ></span>
    {/each}
  </div>
{:else}
  <span aria-hidden="true" class="gm-skeleton {radius[shape]} {extra}" style:width style:height></span>
{/if}
