<!--
  One provider — ARCHITECTURE.md §7, DESIGN_SYSTEM.md §11.1.

  A card rather than a table row. A provider carries a switch, a health signal,
  an interval, a capability list, an adapter status and two actions; laid out
  as a table that is nine columns wide at 1440 and unreadable at 390. There are
  single digits of providers, so vertical space is not the constraint.

  ## The three states that are easy to confuse

  `isEnabled`, `healthState` and `adapterRegistered` are independent, and an
  operator debugging "why is the wall empty" needs to tell them apart:

  - **Disabled** is a decision. Nothing is synced, the wall excludes it, and
    its postbacks are rejected.
  - **Down** is a signal, and deliberately *not* a switch — the provider is
    still called, which is the only way it can ever record a success and
    recover.
  - **No adapter** is a build problem: a row exists whose code or credentials
    do not. `registrationError` carries the reason, and showing it is the
    entire point of the registry keeping failed rows instead of dropping them.

  Nothing here names a concrete network (P1). The card renders a slug, a
  display name and a set of declared capabilities, and would render AdGem and
  the mock identically.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import PlugZap from '@lucide/svelte/icons/plug-zap';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import type { ProviderSummary, SyncRunSummary } from '@gemone/contracts';

  import { Alert, Badge, Button, Card, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import {
    SYNC_MODES_IN_ORDER,
    capabilityLabel,
    formatInterval,
    healthState,
    syncModeHint,
    syncModeLabel,
    syncOutcome,
  } from '$lib/admin/providers';
  import { absoluteDate, relativeTime } from '$lib/rewards/ledger';

  type Props = {
    provider: ProviderSummary;
    /** The latest run for this provider, if it has ever synced. */
    run: SyncRunSummary | undefined;
    now: string;
    /** Which action is in flight anywhere on the page, or `null`. */
    busy: string | null;
    onbusy: (action: string | null) => void;
  };

  let { provider, run, now, busy, onbusy }: Props = $props();

  const health = $derived(healthState(provider.healthState));
  const outcome = $derived(run ? syncOutcome(run.outcome) : null);

  const modeOptions: SelectOption[] = SYNC_MODES_IN_ORDER.map((mode) => ({
    value: mode,
    label: syncModeLabel(mode),
  }));

  let mode = $state<string>('INCREMENTAL');

  const enableAction = $derived(provider.isEnabled ? 'disable' : 'enable');
  const enableKey = $derived(`${enableAction}:${provider.id}`);
  const syncKey = $derived(`sync:${provider.id}`);
</script>

<Card as="article" padding="lg" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 class="gm-card-title">{provider.displayName}</h3>
      <p class="gm-caption font-mono">{provider.slug}</p>
    </div>

    <div class="flex flex-wrap gap-1">
      <Badge variant={provider.isEnabled ? 'success' : 'neutral'}>
        {provider.isEnabled ? 'Enabled' : 'Disabled'}
      </Badge>
      <Badge variant={health.tone}>{health.label}</Badge>
      {#if !provider.adapterRegistered}
        <Badge variant="error">No adapter</Badge>
      {/if}
    </div>
  </div>

  {#if !provider.adapterRegistered}
    <!--
      The reason the registry keeps failed rows instead of dropping them: a
      provider that vanished is one that "stopped working" with nothing to
      point at.
    -->
    <Alert variant="error" title="This build cannot run this provider" live={false}>
      {provider.registrationError ?? 'No adapter is registered for this slug.'}
    </Alert>
  {/if}

  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
    <div>
      <dt class="gm-caption">Last successful sync</dt>
      <dd class="font-medium text-text">
        {#if provider.lastSuccessfulSyncAt}
          <time datetime={provider.lastSuccessfulSyncAt} title={absoluteDate(provider.lastSuccessfulSyncAt)}>
            {relativeTime(provider.lastSuccessfulSyncAt, now)}
          </time>
        {:else}
          Never
        {/if}
      </dd>
    </div>

    <div>
      <dt class="gm-caption">Sync interval</dt>
      <dd class="font-medium text-text">{formatInterval(provider.syncIntervalMinutes)}</dd>
    </div>

    <div>
      <dt class="gm-caption">Consecutive failures</dt>
      <dd class="font-medium text-text">{provider.consecutiveFailureCount}</dd>
    </div>
  </dl>

  {#if provider.capabilities.length > 0}
    <div>
      <p class="gm-caption">Declared capabilities</p>
      <p class="mt-1 flex flex-wrap gap-1">
        {#each provider.capabilities as capability (capability)}
          <Badge variant="info">{capabilityLabel(capability)}</Badge>
        {/each}
      </p>
    </div>
  {/if}

  <div class="border-t border-border pt-4">
    <p class="gm-caption">Latest synchronization</p>

    {#if !run}
      <p class="gm-subtitle mt-1">This provider has never been synchronized.</p>
    {:else}
      <p class="mt-1 flex flex-wrap items-center gap-2">
        <Badge variant={outcome?.tone ?? 'neutral'}>{outcome?.label}</Badge>
        <span class="text-sm text-text-secondary">{run.mode.toLowerCase()}</span>
        <time class="text-xs text-text-muted" datetime={run.startedAt}>
          {relativeTime(run.startedAt, now)}
        </time>
      </p>

      <!--
        The counts the sync run records. `offersRejected` is the one worth
        surfacing: "the catalog is smaller than yesterday" is a question that
        gets asked, and a rejection count is an answer somebody can act on.
      -->
      <dl class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div class="flex gap-1.5">
          <dt class="text-text-secondary">Fetched</dt>
          <dd class="font-medium text-text">{run.offersFetched}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt class="text-text-secondary">Created</dt>
          <dd class="font-medium text-text">{run.offersCreated}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt class="text-text-secondary">Updated</dt>
          <dd class="font-medium text-text">{run.offersUpdated}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt class="text-text-secondary">Deactivated</dt>
          <dd class="font-medium text-text">{run.offersDeactivated}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt class="text-text-secondary">Rejected</dt>
          <dd class="font-medium text-text">{run.offersRejected}</dd>
        </div>
      </dl>

      {#if run.errorSummary}
        <p class="mt-2 text-sm text-danger-text">{run.errorSummary}</p>
      {/if}
    {/if}
  </div>

  <div class="flex flex-col gap-3 border-t border-border pt-4">
    <!--
      Enabling and disabling both demand a reason of at least eight characters,
      which is the API's rule and not this form's. The field is not marked
      optional for that reason, and the message the server sends back when it
      is too short is what the operator sees.
    -->
    <form
      method="POST"
      action="?/{enableAction}"
      class="flex flex-col gap-2 sm:flex-row sm:items-end"
      use:enhance={({ cancel }) => {
        if (busy) return cancel();
        onbusy(enableKey);

        return async ({ update }) => {
          // `reset: false` so a rejected reason survives for editing rather
          // than emptying the field the server just complained about.
          await update({ reset: false });
          onbusy(null);
        };
      }}
    >
      <input type="hidden" name="providerId" value={provider.id} />

      <Input
        label={provider.isEnabled ? 'Why disable it' : 'Why enable it'}
        name="reason"
        required
        minlength={8}
        maxlength={500}
        autocomplete="off"
        class="sm:flex-1"
      />

      <Button
        type="submit"
        variant={provider.isEnabled ? 'secondary' : 'primary'}
        loading={busy === enableKey}
        disabled={busy !== null}
      >
        <PlugZap size={16} aria-hidden="true" />
        {provider.isEnabled ? 'Disable' : 'Enable'}
      </Button>
    </form>

    <form
      method="POST"
      action="?/sync"
      class="flex flex-col gap-2 sm:flex-row sm:items-end"
      use:enhance={({ cancel }) => {
        if (busy) return cancel();
        onbusy(syncKey);

        return async ({ update }) => {
          await update({ reset: false });
          onbusy(null);
        };
      }}
    >
      <input type="hidden" name="providerId" value={provider.id} />

      <Select
        label="Synchronize catalog"
        name="mode"
        bind:value={mode}
        options={modeOptions}
        hint={syncModeHint(mode as 'INCREMENTAL' | 'FULL')}
        class="sm:flex-1"
      />

      <Button
        type="submit"
        variant="secondary"
        loading={busy === syncKey}
        disabled={busy !== null || !provider.isEnabled}
      >
        <RefreshCw size={16} aria-hidden="true" />
        Sync now
      </Button>
    </form>

    {#if !provider.isEnabled}
      <!--
        Not a guess: `CatalogSyncService` refuses a disabled provider, so a
        button that could only 409 is a button that should not be pressable.
      -->
      <p class="gm-caption">A disabled provider cannot be synchronized.</p>
    {/if}
  </div>
</Card>
