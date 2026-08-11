<!--
  Earnings — DESIGN_SYSTEM.md §11.3, §12, §15.2.

  ```
  Earnings                                    + Withdraw
  Available · Pending · Total earned          (tinted wallet cards)
  ┌───────────────────────────────────────────────────────┐
  │ Statement                          Show: [ filter ]   │
  │ table · pager                                         │
  └───────────────────────────────────────────────────────┘
  ```

  Deliberately **not** a second dashboard. No locked bucket (that belongs to
  the withdrawal reserving it, on `/payouts`), no proportion bar, no account
  panel, no recent-activity summary — this screen exists to answer "where did
  this number come from", and the statement is the answer.
-->
<script lang="ts">
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';

  import { BalanceSummary, Statement } from '$lib/components/earnings';
  import { Button, PageHeader } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head><title>Earnings · GemOne</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Earnings"
    description="Your balance, and every movement behind it."
  >
    {#snippet actions()}
      <Button href="/payouts" variant="secondary">
        <ArrowDownToLine size={16} aria-hidden="true" />
        Withdraw
      </Button>
    {/snippet}
  </PageHeader>

  <BalanceSummary balance={data.balance} rate={data.payoutOptions} />

  <Statement
    statement={data.statement}
    now={data.now}
    offset={data.offset}
    pageSize={data.pageSize}
    type={data.type}
    query={data.query}
  />
</div>
