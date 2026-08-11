<!--
  The one filter the statement has — DESIGN_SYSTEM.md §10.1.

  `GET /rewards/history` accepts exactly three parameters: `type`, `limit` and
  `offset`. So there is one filter, on transaction type, and it is a plain
  `<form method="GET">`.

  ## Why a GET form and not client state

  The result is a URL. `?type=CONVERSION_CREDIT&offset=40` is bookmarkable,
  shareable, survives a reload and is what the Back button undoes — none of
  which is true of a filter held in a component. It also means no store, no
  fetch, no loading spinner of its own: the server load reads
  `url.searchParams` and SvelteKit's own navigation does the rest.

  **`offset` is deliberately not carried across.** Changing the filter changes
  the result set, and page 3 of the old one is not page 3 of the new one — it
  is usually past the end, which renders an empty page and reads as "there is
  nothing here".

  ## Status is not a filter

  The brief asks for status filtering "if the existing API supports it
  naturally". It does not: a movement's status is *derived* in
  `$lib/rewards/ledger.ts` from its type and its bucket deltas, and there is no
  status column to filter on. Filtering it here would mean paging through the
  whole ledger client-side and showing "12 results" on a page that fetched 20 —
  a filter that lies about how much it found. Recorded as TODO T80.
-->
<script lang="ts">
  import type { RewardTransactionType } from '@gemone/contracts';

  import { Button, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { LEDGER_TYPES, describe } from '$lib/rewards/ledger';

  type Props = {
    /** The active type, or `''` for everything. */
    value: RewardTransactionType | '';
  };

  let { value }: Props = $props();

  const options: SelectOption[] = [
    { value: '', label: 'All movements' },
    ...LEDGER_TYPES.map((type) => ({ value: type, label: describe(type) })),
  ];
</script>

<form method="GET" class="flex flex-wrap items-end gap-3">
  <Select
    label="Show"
    name="type"
    {options}
    {value}
    class="min-w-48 flex-1 sm:flex-none"
    onchange={(event) => event.currentTarget.form?.requestSubmit()}
  />

  <!--
    Kept even though the select submits itself. `requestSubmit` needs
    JavaScript; the button is what makes the filter work without it, and it
    costs one control.
  -->
  <Button type="submit" variant="secondary">Apply</Button>
</form>
