<!--
  Every registered setting, grouped by the concern that owns it — P3, §4.9.

  ## The grouping is derived, not declared

  A key is "namespaced by owning concern" by declaration — `rewards.`,
  `payouts.`, `fraud.` — so the namespace is a fact about the key rather than a
  taxonomy this screen invented. A module registering `email.` gets its own
  group with no change here, which is the whole reason this page has no list of
  settings in it.

  ## What each row says, in the order it is asked

  The key's own description first, because that is the backend explaining what
  the setting does — including the operationally significant part, where there
  is one: the hold period's description says it is *"resolved at credit time and
  stored on the transaction"*, which is the sentence that stops an operator
  expecting a change to affect points already credited.

  Then the value in force, then **where it came from**. That last one is §4.9's
  reason for existing: an admin who cannot tell an explicit setting from an
  unset one cannot change either safely.

  ## No pagination

  `AdminConfigurationKeyList` has none, and correctly: keys are declared in code
  and counted in tens. A pager over thirty rows would be ceremony.
-->
<script lang="ts">
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

  import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '$lib/components/ui';
  import { formatValue, groupByNamespace, keyLabel, sourceState } from '$lib/admin/settings';

  import SettingsFilters from './SettingsFilters.svelte';
  import type { SettingsListResult } from './types';

  type Props = {
    settings: Promise<SettingsListResult>;
    search: string;
    overriddenOnly: boolean;
  };

  let { settings, search, overriddenOnly }: Props = $props();

  const applied = $derived(
    [search ? `“${search}”` : '', overriddenOnly ? 'changed from the default' : ''].filter(Boolean),
  );
</script>

<Card as="section" padding="lg" aria-labelledby="settings-title">
  <div class="flex flex-col gap-4">
    <div>
      <h2 id="settings-title" class="gm-card-title">Settings</h2>
      <p class="gm-subtitle mt-1">
        Every value the platform reads at runtime. Each one is declared by the part of the system
        that uses it.
      </p>
    </div>

    <SettingsFilters {search} {overriddenOnly} />
  </div>

  <div class="mt-5">
    {#await settings}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading settings</span>
        {#each [0, 1, 2, 3, 4, 5] as row (row)}
          <div class="flex items-center gap-3">
            <div class="flex-1"><Skeleton lines={2} height="0.75rem" /></div>
            <Skeleton width="6rem" height="0.875rem" />
          </div>
        {/each}
      </div>
    {:then page}
      {#if !page.ok}
        <ErrorState
          title="The settings could not be loaded"
          description="No value has changed. Refresh the page to try again."
        />
      {:else if page.items.length === 0 && applied.length > 0}
        <EmptyState
          icon={SlidersHorizontal}
          title="No settings match this filter"
          description="Nothing registered matches {applied.join(' and ')}."
        >
          {#snippet action()}
            <Button href="/admin/settings" variant="secondary" size="sm">Show every setting</Button>
          {/snippet}
        </EmptyState>
      {:else if page.items.length === 0}
        <!--
          Only reachable on a build where no module registered a key. It is not
          a broken page, and saying so is cheaper than an operator wondering.
        -->
        <EmptyState
          icon={SlidersHorizontal}
          title="No settings are registered"
          description="Keys are declared in code by the part of the system that reads them. This build declares none."
        />
      {:else}
        <div class="flex flex-col gap-6">
          {#each groupByNamespace(page.items) as group (group.namespace)}
            <section aria-labelledby="group-{group.namespace}">
              <h3 id="group-{group.namespace}" class="gm-card-title text-base capitalize">
                {group.namespace}
              </h3>

              <ul class="mt-3 flex flex-col gap-3">
                {#each group.items as setting (setting.key)}
                  {@const source = sourceState(setting.source)}
                  <li class="border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <a
                      href="/admin/settings/{encodeURIComponent(setting.key)}"
                      class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 hover:no-underline"
                    >
                      <div class="min-w-0 flex-1">
                        <p class="font-medium text-text">{keyLabel(setting.key)}</p>
                        <p class="gm-caption font-mono break-all">{setting.key}</p>
                        <p class="gm-caption mt-1">{setting.description}</p>
                      </div>

                      <div class="flex flex-col items-start gap-2 sm:items-end">
                        <p class="font-mono text-sm break-all text-text">
                          {formatValue(setting.effectiveValue)}
                        </p>
                        <div class="flex flex-wrap gap-2">
                          <Badge variant={source.tone}>{source.label}</Badge>
                          {#if setting.overrideCount > 0}
                            <!--
                              A provider row wins over the global one, so this
                              is not decoration: it is the count of providers
                              for which the value above is not what applies.
                            -->
                            <Badge variant="warning">
                              {setting.overrideCount} provider override{setting.overrideCount === 1
                                ? ''
                                : 's'}
                            </Badge>
                          {/if}
                        </div>
                      </div>
                    </a>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    {/await}
  </div>
</Card>
