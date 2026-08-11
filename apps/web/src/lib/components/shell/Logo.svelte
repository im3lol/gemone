<!--
  Logo — DESIGN_SYSTEM.md §20.2.

  The faceted gem, reproduced path-for-path with its three literal greens.
  These are **not** brand tokens and must not be swapped for them: the mark was
  drawn with its own palette (`#039855` body, `#12b76a` right facet, `#32d583`
  top facet at 85%), and re-tinting it to `brand-500` flattens the facets into
  one shade.

  The legacy source calls this a placeholder — *"swap for real brand asset when
  available"* — and it shipped that way. It is reproduced as-is because it is
  what the screenshots show; replacing it is a branding decision, not a
  rebuilding one.

  The `<svg>` is `aria-hidden`: the wordmark beside it already says the name,
  and a second announcement would make every logo link read twice.
-->
<script lang="ts">
  type Props = {
    /** `md` is the sidebar and topbar; `lg` is the auth card (DS §19). */
    size?: 'md' | 'lg';
    /** Mark only — for the mobile bar, where the wordmark will not fit. */
    wordmarkHidden?: boolean;
    class?: string;
  };

  let { size = 'md', wordmarkHidden = false, class: extra = '' }: Props = $props();

  const mark = { md: 'size-8', lg: 'size-11' };
  const word = { md: 'text-xl', lg: 'text-2xl' };
</script>

<span class="inline-flex items-center gap-2 {extra}">
  <svg viewBox="0 0 32 32" aria-hidden="true" class="{mark[size]} shrink-0">
    <path d="M8 4h16l6 10-14 14L2 14 8 4Z" fill="#039855" />
    <path d="M16 4h8l6 10-14 14 0-24Z" fill="#12b76a" />
    <path d="M8 4h16l-4 8H12L8 4Z" fill="#32d583" opacity="0.85" />
  </svg>

  {#if !wordmarkHidden}
    <span class="font-display {word[size]} font-bold tracking-tight text-text">GemOne</span>
  {/if}
</span>
