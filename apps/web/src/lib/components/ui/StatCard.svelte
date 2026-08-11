<!--
  StatCard — DESIGN_SYSTEM.md §11.2–11.3, docs/UI_KIT.md.

  Label top-left, tinted circular icon top-right, the number, its unit, and an
  optional accent line beneath. The dashboard, the earnings page and the admin
  metrics row all want it.

  Two treatments, both from legacy: the default puts the tint on a 36px circle
  behind the icon (§11.2); `filled` tints the whole card and drops the icon
  (§11.3, the wallet variant).

  ## Trend

  `trend` takes a direction rather than inferring one from a sign, because
  "down" is not always bad — a falling reversal rate is good news, and a
  component that colours by arithmetic would call it a loss. The caller says
  what the number means.
-->
<script lang="ts">
  import TrendingDown from '@lucide/svelte/icons/trending-down';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import type { Component } from 'svelte';
  import type { LucideProps } from '@lucide/svelte';

  type Tone = 'brand' | 'blue' | 'amber' | 'purple';

  type Props = {
    label: string;
    value: string | number;
    /** Rendered small and muted under the value — "points", "USD", "today". */
    unit?: string;
    tone?: Tone;
    icon?: Component<LucideProps>;
    /** Whole-card tint instead of an icon circle (DS §11.3). */
    filled?: boolean;
    trend?: {
      label: string;
      direction: 'up' | 'down' | 'flat';
      /** `positive` colours it brand green, `negative` red, `neutral` muted. */
      sentiment?: 'positive' | 'negative' | 'neutral';
    };
    class?: string;
  };

  let {
    label,
    value,
    unit,
    tone = 'brand',
    icon,
    filled = false,
    trend,
    class: extra = '',
  }: Props = $props();

  // Legacy's four dashboard pairs, verbatim (DS §11.2).
  const tints: Record<Tone, string> = {
    brand: 'bg-brand-50',
    blue: 'bg-info-soft',
    amber: 'bg-warning-soft',
    purple: 'bg-[#faf5ff]',
  };

  const accents: Record<Tone, string> = {
    brand: 'text-brand-600',
    blue: 'text-info-text',
    amber: 'text-warning-text',
    purple: 'text-[#9810fa]',
  };

  const sentiments = {
    positive: 'text-brand-600',
    negative: 'text-danger-text',
    neutral: 'text-text-muted',
  };

  const Icon = $derived(icon);
  const TrendIcon = $derived(
    trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : undefined,
  );
</script>

<div class="gm-card {filled ? tints[tone] : ''} {extra}">
  <div class="flex items-start justify-between gap-3">
    <p class="text-sm font-medium text-text-secondary">{label}</p>
    {#if Icon && !filled}
      <span class="grid size-9 shrink-0 place-items-center rounded-control {tints[tone]} {accents[tone]}">
        <Icon size={20} aria-hidden="true" />
      </span>
    {/if}
  </div>

  <p class="mt-3 text-3xl leading-9 font-bold text-text">{value}</p>

  {#if unit}
    <p class="gm-caption">{unit}</p>
  {/if}

  {#if trend}
    <p class="mt-2 flex items-center gap-1 text-xs font-medium {sentiments[trend.sentiment ?? 'neutral']}">
      {#if TrendIcon}
        <TrendIcon size={14} aria-hidden="true" />
      {/if}
      {trend.label}
    </p>
  {/if}
</div>
