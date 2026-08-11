<!--
  Alert — DESIGN_SYSTEM.md §10.3, docs/UI_KIT.md.

  Legacy has exactly two inline notices, error and success, both a tinted box
  with no icon and no border. Warning and info are added from the same recipe
  because the admin surfaces in later phases need them, and a hairline border
  is added because a pale tint alone is invisible against a white card.

  ## The part that is not decoration

  `role` is chosen by variant, and it is the whole reason to use this component
  rather than a styled `<div>`:

  - `error` and `warning` → `role="alert"`, an assertive live region. A failed
    login is announced the moment it renders, without moving focus.
  - `success` and `info` → `role="status"`, polite. A confirmation waits for a
    gap in speech instead of interrupting.

  Pass `live={false}` for content that is present on first paint and is not
  news — a standing explanation at the top of a form. Announcing that on every
  page load trains people to ignore the region that matters.
-->
<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { Snippet } from 'svelte';

  type Variant = 'success' | 'warning' | 'error' | 'info';

  type Props = {
    variant?: Variant;
    /** Bold first line. The body becomes the explanation beneath it. */
    title?: string;
    /** Announce on render. Off for static, always-present copy. */
    live?: boolean;
    class?: string;
    children?: Snippet;
  };

  let { variant = 'info', title, live = true, class: extra = '', children }: Props = $props();

  const icons = {
    success: CircleCheck,
    warning: TriangleAlert,
    error: CircleAlert,
    info: Info,
  };

  const Icon = $derived(icons[variant]);
  const role = $derived(
    live ? (variant === 'error' || variant === 'warning' ? 'alert' : 'status') : undefined,
  );
</script>

<div {role} class="gm-alert gm-alert--{variant} {extra}">
  <Icon size={16} aria-hidden="true" class="gm-alert__icon" />
  <div class="gm-alert__body">
    {#if title}
      <p class="gm-alert__title">{title}</p>
    {/if}
    {@render children?.()}
  </div>
</div>
