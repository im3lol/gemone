<!--
  PageHeader — DESIGN_SYSTEM.md §15.2, §4.5, docs/UI_KIT.md.

  Title, optional description, optional right-hand actions. Twelve of the
  application's twelve rendered routes want this block, and today all twelve
  write their own `<h1>` with their own spacing (UI_AUDIT.md F10).

  Stacks below `sm` and goes row-wise above it — legacy's own behaviour for
  admin page headers (DS §22.2), and the reason an action button never crowds
  a long title on a phone.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    description?: string;
    /** `page` renders an `<h1>`; `section` an `<h2>` for a block inside one. */
    level?: 'page' | 'section';
    class?: string;
    /** Buttons or links aligned to the end of the row. */
    actions?: Snippet;
  };

  let { title, description, level = 'page', class: extra = '', actions }: Props = $props();
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between {extra}">
  <div class="min-w-0">
    {#if level === 'page'}
      <h1>{title}</h1>
    {:else}
      <h2>{title}</h2>
    {/if}
    {#if description}
      <p class="gm-subtitle mt-1">{description}</p>
    {/if}
  </div>

  {#if actions}
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
