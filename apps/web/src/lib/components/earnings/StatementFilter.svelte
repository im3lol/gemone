<!--
  The statement's two filters — DESIGN_SYSTEM.md §10.1.

  **Type** is what a movement was: a conversion credit, a chargeback, a
  withdrawal. **Status** is where its points are now: pending, available,
  cleared. They are different questions about the same row — a credit and its
  maturation are two types and the same money — and a user asking "what is
  still pending?" is asking the second one.

  ## Why a GET form and not client state

  The result is a URL. `?status=PENDING&offset=40` is bookmarkable, shareable,
  survives a reload and is what the Back button undoes — none of which is true
  of a filter held in a component. It also means no store, no fetch, no loading
  spinner of its own: the server load reads `url.searchParams` and SvelteKit's
  own navigation does the rest.

  **`offset` is deliberately not carried across.** Changing either filter
  changes the result set, and page 3 of the old one is not page 3 of the new
  one — it is usually past the end, which renders an empty page and reads as
  "there is nothing here". Neither select is inside a form that carries the
  offset, so submitting always lands on page one.

  ## Both filters are applied by the API

  Status used to be impossible to filter on: it is *derived* from a movement's
  type and its bucket deltas, and there was no column to filter by, so doing it
  here would have meant fetching twenty rows, hiding some, and printing
  "1–20 of 28" above a list of four. The derivation now lives in
  `@gemone/contracts` and the API builds its `where` from the same rules
  (TODO T80), so the count below the table is the count of what matched.
-->
<script lang="ts">
  import type { RewardStatus, RewardTransactionType } from '@gemone/contracts';

  import { Button, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { LEDGER_STATUSES, LEDGER_TYPES, describe, statusLabel } from '$lib/rewards/ledger';

  type Props = {
    /** The active type, or `''` for everything. */
    type: RewardTransactionType | '';
    /** The active status, or `''` for everything. */
    status: RewardStatus | '';
  };

  let { type, status }: Props = $props();

  const typeOptions: SelectOption[] = [
    { value: '', label: 'All movements' },
    ...LEDGER_TYPES.map((value) => ({ value, label: describe(value) })),
  ];

  const statusOptions: SelectOption[] = [
    { value: '', label: 'Any status' },
    ...LEDGER_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
  ];
</script>

<form method="GET" class="flex flex-wrap items-end gap-3">
  <Select
    label="Show"
    name="type"
    options={typeOptions}
    value={type}
    class="min-w-44 flex-1 sm:flex-none"
    onchange={(event) => event.currentTarget.form?.requestSubmit()}
  />

  <Select
    label="Status"
    name="status"
    options={statusOptions}
    value={status}
    class="min-w-40 flex-1 sm:flex-none"
    onchange={(event) => event.currentTarget.form?.requestSubmit()}
  />

  <!--
    Kept even though the selects submit themselves. `requestSubmit` needs
    JavaScript; the button is what makes the filters work without it, and it
    costs one control.
  -->
  <Button type="submit" variant="secondary">Apply</Button>
</form>
