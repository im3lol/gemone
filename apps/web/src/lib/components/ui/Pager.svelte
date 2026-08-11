<!--
  Offset pagination — docs/UI_KIT.md.

  Every paginated endpoint in this API takes `limit` and `offset`, so a pager
  is two links and a count. This was `earnings/StatementPager.svelte` until the
  offer wall needed the same thing; it moved here rather than being copied,
  because the second copy is where two pagers start disagreeing about whether
  the last page shows a Next.

  Links, not buttons: each page is a URL, so Previous and Next are navigations.
  That makes them middle-clickable, bookmarkable and undoable with the Back
  button, and it means the pager needs no JavaScript at all.

  ## Accessibility

  A `<nav>` with its own label, because a page can hold several and
  "navigation" on its own tells a screen-reader user nothing. The count is not
  decoration either — it is the only thing that says how far through you are,
  so it is real text between the two links rather than a `title`.

  The edges are **absent, not disabled**. A disabled link is a focus stop that
  does nothing; there is no previous page from page one, so there is no control.
-->
<script lang="ts">
  type Props = {
    /** Index of the first row on this page. */
    offset: number;
    pageSize: number;
    total: number;
    /** Everything the links must preserve — the active filters. */
    query: URLSearchParams;
    /** The path the links point at, without a query string. */
    base: string;
    /** What this nav is for, since a page may hold more than one. */
    label: string;
  };

  let { offset, pageSize, total, query, base, label }: Props = $props();

  const first = $derived(total === 0 ? 0 : offset + 1);
  const last = $derived(Math.min(offset + pageSize, total));

  function linkTo(nextOffset: number): string {
    const params = new URLSearchParams(query);

    // `?offset=0` is the default; leaving it out keeps the first page's URL
    // identical to the one the navigation started from.
    if (nextOffset > 0) params.set('offset', String(nextOffset));
    else params.delete('offset');

    const search = params.toString();
    return search ? `${base}?${search}` : base;
  }

  const previous = $derived(offset > 0 ? linkTo(Math.max(0, offset - pageSize)) : null);
  const next = $derived(offset + pageSize < total ? linkTo(offset + pageSize) : null);
</script>

{#if previous || next}
  <nav
    aria-label={label}
    class="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4"
  >
    {#if previous}
      <a href={previous} class="gm-btn gm-btn--secondary gm-btn--sm" rel="prev">Previous</a>
    {:else}
      <span></span>
    {/if}

    <p class="gm-caption">
      {first}–{last} of {total.toLocaleString('en-US')}
    </p>

    {#if next}
      <a href={next} class="gm-btn gm-btn--secondary gm-btn--sm" rel="next">Next</a>
    {:else}
      <span></span>
    {/if}
  </nav>
{/if}
