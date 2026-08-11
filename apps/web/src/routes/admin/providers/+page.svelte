<!--
  Providers — ARCHITECTURE.md §7, PROJECT.md §1 (P1).

  ```
  Providers
  ┌──────────────────────────────────────────┐
  │ Register a provider   [adapter ▾] [name] │
  └──────────────────────────────────────────┘
  ┌─────────────────────┐ ┌─────────────────────┐
  │ Mock Offerwall      │ │ …                   │
  │ Enabled · Healthy   │ │                     │
  │ last sync · counts  │ │                     │
  │ [Enable] [Sync now] │ │                     │
  └─────────────────────┘ └─────────────────────┘
  ```

  The operator's whole job in one screen: register an adapter the build ships,
  enable it, synchronize its catalog, and read what the run did. Every phase
  before this one did those three with hand-written API calls.

  ## One action at a time

  `busy` is page-level, not per-form. Every action here changes what the next
  load renders, and each form's `use:enhance` re-runs that load — so two in
  flight together means a page that reloads into a state neither produced. The
  API refuses nothing; this is about the reload, not about safety.

  ## Why the registration panel waits for the list

  It needs the registered slugs, to stop offering an adapter that already has a
  row — and those arrive with the streamed list. So it sits inside the same
  `{#await}`, which is one promise awaited in two places rather than two calls.
-->
<script lang="ts">
  import { ProviderList, RegisterProvider } from '$lib/components/admin';
  import { Alert, PageHeader, Skeleton } from '$lib/components/ui';

  let { data, form } = $props();

  /** Which action is in flight. Each form sets it and clears it. */
  let busy = $state<string | null>(null);

  const onbusy = (action: string | null) => {
    busy = action;
  };
</script>

<svelte:head><title>Providers · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Providers"
    description="Offerwall networks this deployment can source offers from."
  />

  {#if form}
    <Alert variant={form.ok ? 'success' : 'error'} title={form.ok ? 'Done' : 'That did not work'}>
      {form.message}
    </Alert>
  {/if}

  {#await data.providers}
    <div class="gm-card"><Skeleton lines={2} height="0.875rem" /></div>
  {:then result}
    {#if result.ok}
      <RegisterProvider
        adapters={data.adapters}
        registeredSlugs={result.items.map((provider) => provider.slug)}
        {busy}
        {onbusy}
      />
    {/if}
  {/await}

  <ProviderList providers={data.providers} now={data.now} {busy} {onbusy} />
</div>
