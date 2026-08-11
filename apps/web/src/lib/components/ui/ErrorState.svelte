<!--
  ErrorState — docs/UI_KIT.md, UI_AUDIT.md U2.

  The user-facing failure block: what went wrong, what it means, and the way
  out. It is the body of a future `+error.svelte` and of any panel whose data
  did not load — the application currently has neither, so a failed load shows
  SvelteKit's unstyled default page.

  ## What it deliberately does not do

  It does not print the exception. `detail` is for a correlation id or an API
  error code — something a person can quote to support. Stack traces and
  internal messages leak implementation detail to whoever is looking at the
  screen, and they are never the sentence that helps.
-->
<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import type { Snippet } from 'svelte';

  type Props = {
    title?: string;
    description?: string;
    /** A short, quotable code — an error code or request id. Never a stack. */
    detail?: string;
    class?: string;
    /** Retry, go back, contact support. */
    action?: Snippet;
  };

  let {
    title = 'Something went wrong',
    description = 'The page could not be loaded. Try again in a moment.',
    detail,
    class: extra = '',
    action,
  }: Props = $props();
</script>

<div role="alert" class="gm-empty border-danger-border {extra}">
  <CircleAlert size={24} aria-hidden="true" class="text-danger" />

  <p class="font-semibold text-text">{title}</p>
  <p class="gm-subtitle max-w-prose">{description}</p>

  {#if detail}
    <p class="gm-caption font-mono">{detail}</p>
  {/if}

  {#if action}
    <div class="mt-2">
      {@render action()}
    </div>
  {/if}
</div>
