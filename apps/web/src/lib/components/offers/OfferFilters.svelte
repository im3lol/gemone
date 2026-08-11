<!--
  The wall's filter bar — DESIGN_SYSTEM.md §10.1.

  A `<form method="GET">`, so the result is a **URL**:
  `?search=survey&category=SURVEY&sort=reward_desc`. Bookmarkable, shareable,
  survives a reload, undone by the Back button, and working with JavaScript
  off — the same shape the statement's filter uses, for the same reasons.

  ## Three filters, and not the other four

  `GET /offers` also takes `minRewardPoints`, `maxRewardPoints`, `country` and
  `device`. None is here. The reward bounds want a range control this kit does
  not have and the wall is not long enough to need; country and device are
  **not eligibility** — the contract is explicit that they narrow a wall rather
  than decide who may click — so a visible country picker would read as a
  restriction the platform does not actually apply.

  ## `offset` is not preserved

  Deliberately absent from the form. Page 3 of the old result set is not page 3
  of the new one; it is usually past the end, which renders empty and reads as
  "there is nothing here". Submitting a filter returns you to page one.
-->
<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import type { OfferCategory, WallOfferSort } from '@gemone/contracts';

  import { Button, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import {
    OFFER_CATEGORIES_IN_ORDER,
    OFFER_SORTS_IN_ORDER,
    categoryLabel,
    sortLabel,
  } from '$lib/offers/offer';

  type Props = {
    search: string;
    category: OfferCategory | '';
    sort: WallOfferSort | '';
  };

  let { search, category, sort }: Props = $props();

  const categoryOptions: SelectOption[] = [
    { value: '', label: 'All categories' },
    ...OFFER_CATEGORIES_IN_ORDER.map((value) => ({ value, label: categoryLabel(value) })),
  ];

  const sortOptions: SelectOption[] = OFFER_SORTS_IN_ORDER.map((value) => ({
    value,
    label: sortLabel(value),
  }));

  /*
   * The controls read straight from the props, with no local copy.
   *
   * Every filter change is a navigation, so the URL is the state and the
   * server hands back what it applied. A local `$state` seeded from the props
   * would capture only the first value — and then "Show all offers", or the
   * Back button, would move the wall while leaving the dropdown showing the
   * filter that is no longer in effect.
   *
   * An empty `sort` shows the API's own default rather than a blank option:
   * `reward_desc` is what an unsorted wall already is.
   */
  const selectedSort = $derived(sort || 'reward_desc');

  /*
   * The dropdowns submit on change, where a change *is* the whole intent. The
   * search box does not: a request per keystroke against the catalog is a cost
   * the user did not ask for.
   */
  function submit(event: Event & { currentTarget: HTMLElement }): void {
    (event.currentTarget.closest('form') as HTMLFormElement | null)?.requestSubmit();
  }
</script>

<form method="GET" action="/offers" class="flex flex-col gap-3 sm:flex-row sm:items-end">
  <Input
    label="Search offers"
    name="search"
    type="search"
    value={search}
    placeholder="Search by title"
    class="sm:flex-1"
  />

  <Select
    label="Category"
    name="category"
    value={category}
    options={categoryOptions}
    onchange={submit}
    class="sm:w-44"
  />

  <Select
    label="Sort by"
    name="sort"
    value={selectedSort}
    options={sortOptions}
    onchange={submit}
    class="sm:w-44"
  />

  <!--
    Present for the search box, which does not auto-submit, and for anyone
    without JavaScript, for whom neither dropdown does either.
  -->
  <Button type="submit" variant="secondary" class="sm:mb-0">
    <Search size={16} aria-hidden="true" />
    Search
  </Button>
</form>
