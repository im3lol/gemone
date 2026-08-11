<!--
  Payouts — DESIGN_SYSTEM.md §11.3, §12.

  ```
  Withdraw                                    ← Earnings
  Available · Still clearing · Reserved       (tinted wallet cards)
  ┌───────────────────────────┐ ┌───────────────────────────────┐
  │ Request a withdrawal      │ │ Your withdrawals              │
  │ form / explanation        │ │ table · states                │
  └───────────────────────────┘ └───────────────────────────────┘
  ```

  The form and the history sit side by side above `xl` because they answer each
  other: someone submitting a second request wants to see the first one still
  in review. Below that they stack, form first — the page was opened to ask for
  money, not to read about having asked.

  **`xl`, not `lg`, and that is measured.** At 1024px the sidebar appears at the
  same breakpoint `lg:grid-cols-2` would split these, which left the form's
  fields 285px wide and pushed the document 23px past the viewport — the table
  cannot shrink below its min-content width, and a grid child defaults to
  `min-width: auto`, so it widened its own track instead of scrolling. Waiting
  for `xl` gives both panels the full width at 1024 (fields 655px), and
  `min-w-0` on the history panel keeps the table inside its column rather than
  inside the page.
-->
<script lang="ts">
  import Receipt from '@lucide/svelte/icons/receipt';

  import { PayoutHistory, WithdrawBalance, WithdrawForm } from '$lib/components/payouts';
  import { Button, PageHeader } from '$lib/components/ui';

  let { data, form } = $props();
</script>

<svelte:head><title>Withdraw · GemOne</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Withdraw"
    description="Turn the points you have cleared into a payment."
  >
    {#snippet actions()}
      <Button href="/earnings" variant="secondary">
        <Receipt size={16} aria-hidden="true" />
        Earnings
      </Button>
    {/snippet}
  </PageHeader>

  <WithdrawBalance balance={data.balance} options={data.options} />

  <div class="grid gap-5 xl:grid-cols-2 xl:items-start">
    <WithdrawForm options={data.options} balance={data.balance} result={form} />
    <PayoutHistory history={data.history} now={data.now} />
  </div>
</div>
