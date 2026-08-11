<!--
  The payout queue — ARCHITECTURE.md §11.3, PROJECT.md §3.3.

  The screen that closes the product loop. Everything before it — offers,
  clicks, conversions, rewards, the withdrawal form — ends with a request
  sitting in a queue, and until this page that queue had no screen to be
  decided on.
-->
<script lang="ts">
  import { PayoutQueue } from '$lib/components/admin';
  import { PageHeader } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head><title>Payout queue · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Payouts"
    description="Withdrawal requests, and the decisions taken on them."
  />

  <PayoutQueue
    queue={data.queue}
    now={data.now}
    status={data.status}
    offset={data.offset}
    pageSize={data.pageSize}
    query={data.query}
  />
</div>
