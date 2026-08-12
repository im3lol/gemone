<!--
  Fraud review — PROJECT.md §4.7.

  The last open link in the loop. A conversion is scored, held, and until this
  screen existed the hold had nowhere to be resolved: the API could fill the
  queue and nothing could empty it, which is the failure TODO T29 named "not the
  design". Holding is only the recoverable direction if somebody can recover it.

  Deliberately **not** a fraud dashboard. No score distribution, no rule
  effectiveness, no per-account risk trend — those are analytics, and what an
  operator needs to make the decision the API already accepts is the queue, the
  evidence, and two buttons.
-->
<script lang="ts">
  import { HeldQueue } from '$lib/components/admin';
  import { Alert, PageHeader } from '$lib/components/ui';

  let { data, form } = $props();
</script>

<svelte:head><title>Fraud review · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Fraud review"
    description="Conversions the engine held, and the decision that releases or reverses them."
  />

  <!--
    A success has no card left to sit on: the hold is resolved and gone from
    the queue on the reload that follows. A refusal does have one — the
    conversion is still held — and is shown beside the buttons that were
    pressed, by the card itself.
  -->
  {#if form?.ok}
    <Alert variant="success" title="Recorded">{form.message}</Alert>
  {/if}

  <HeldQueue
    queue={data.queue}
    now={data.now}
    userId={data.userId}
    offset={data.offset}
    pageSize={data.pageSize}
    query={data.query}
    result={form ?? null}
  />
</div>
