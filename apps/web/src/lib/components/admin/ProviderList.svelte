<!--
  The provider list, and all four of its states.

  The same shape as every streamed panel since the dashboard (D83): it takes a
  **promise** the page streams from its `load`, and owns loading / empty /
  error / populated itself.

  No pagination. `GET /admin/providers` returns `{ items }` with no `limit` or
  `offset`, because a deployment has single digits of providers — the API's
  own shape is the reason there is no pager here, not an omission.

  ## The empty state is the one that matters

  A platform with no provider registered has an empty offer wall, no clicks, no
  conversions and no revenue — every screen downstream is empty for this one
  reason. So the empty state names it rather than shrugging.
-->
<script lang="ts">
  import Plug from '@lucide/svelte/icons/plug';

  import { EmptyState, ErrorState, Skeleton } from '$lib/components/ui';

  import ProviderCard from './ProviderCard.svelte';
  import type { ProviderResult } from './types';

  type Props = {
    providers: Promise<ProviderResult>;
    now: string;
    busy: string | null;
    onbusy: (action: string | null) => void;
  };

  let { providers, now, busy, onbusy }: Props = $props();
</script>

{#await providers}
  <div aria-busy="true" aria-live="polite" class="grid gap-5 xl:grid-cols-2">
    <span class="gm-sr-only">Loading providers</span>
    {#each [0, 1] as card (card)}
      <div class="gm-card flex flex-col gap-4">
        <Skeleton lines={2} height="0.875rem" />
        <Skeleton height="3rem" />
        <Skeleton lines={2} height="0.75rem" />
      </div>
    {/each}
  </div>
{:then result}
  {#if !result.ok}
    <ErrorState
      title="Providers could not be loaded"
      description="No provider has changed. Refresh the page to try again."
    />
  {:else if result.items.length === 0}
    <EmptyState
      icon={Plug}
      title="No provider is registered"
      description="The offer wall is empty until one is. Register an adapter this build ships, enable it, and synchronize its catalog."
    />
  {:else}
    <div class="grid gap-5 xl:grid-cols-2">
      {#each result.items as provider (provider.id)}
        <ProviderCard {provider} run={result.runs[provider.id]} {now} {busy} {onbusy} />
      {/each}
    </div>
  {/if}
{/await}
