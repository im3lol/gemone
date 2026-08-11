<!--
  EmptyState — DESIGN_SYSTEM.md §17.2, docs/UI_KIT.md.

  A dashed slate-200 border, centred copy, no illustration. Legacy's offer grid
  is the only place it appears; five current screens need one.

  ## Why the icon is optional and muted

  An empty list is not an error, and an empty state that shouts reads as one.
  The icon is `slate-400` at 24px and `aria-hidden` — it repeats the title,
  which is the thing that actually has to be read.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import type { LucideProps } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    description?: string;
    icon?: Component<LucideProps>;
    class?: string;
    /** A single call to action — the way out of the empty state. */
    action?: Snippet;
  };

  let { title, description, icon, class: extra = '', action }: Props = $props();

  const Icon = $derived(icon);
</script>

<div class="gm-empty {extra}">
  {#if Icon}
    <Icon size={24} aria-hidden="true" class="text-text-muted" />
  {/if}

  <p class="font-semibold text-text">{title}</p>

  {#if description}
    <p class="gm-subtitle max-w-prose">{description}</p>
  {/if}

  {#if action}
    <div class="mt-2">
      {@render action()}
    </div>
  {/if}
</div>
