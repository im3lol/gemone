<!--
  One setting — ARCHITECTURE.md §4.9.

  ```
  ← Settings
  hold period days                              Default · number
  rewards.hold_period_days
  ┌──────────────────────────┬──────────────────────────────┐
  │ Change the global value  │ Stored values                │
  │ reset to default         │ History                      │
  └──────────────────────────┴──────────────────────────────┘
  ```

  The decision on the left, the record on the right, side by side at `xl` so an
  operator does not have to remember what the last change was while typing the
  next one.
-->
<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  import { SettingForm, SettingHistory } from '$lib/components/admin';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import { formatValue, keyLabel, sourceState } from '$lib/admin/settings';

  let { data, form } = $props();

  const setting = $derived(data.setting);

  /*
   * The badge describes the scope being viewed. On a provider's page that is
   * where *that provider's* value comes from, which the API resolved through
   * the chain — `setting.source` is the global answer and would say "Set
   * globally" above a provider override.
   */
  const source = $derived(
    sourceState(
      data.scope === 'PROVIDER' ? (setting.resolvedForScope?.source ?? setting.source) : setting.source,
    ),
  );
</script>

<svelte:head><title>{setting.key} · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <div>
    <Button href="/admin/settings" variant="ghost" size="sm">
      <ArrowLeft size={16} aria-hidden="true" />
      Settings
    </Button>
  </div>

  <PageHeader title={keyLabel(setting.key)} description={setting.description}>
    {#snippet actions()}
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={source.tone}>{source.label}</Badge>
        <Badge variant="neutral">{setting.valueType}</Badge>
      </div>
    {/snippet}
  </PageHeader>

  <p class="gm-caption font-mono break-all">{setting.key}</p>

  <dl class="grid grid-cols-2 gap-4 sm:grid-cols-3">
    <div>
      <!--
        At provider scope this is what *that provider* resolves to, which the
        API computed by walking the chain (§4.9) rather than this page adding
        it up. Labelled so the two are never mistaken for one another.
      -->
      <dt class="gm-caption">
        {data.scope === 'PROVIDER' ? 'In force for this provider' : 'In force'}
      </dt>
      <dd class="font-mono font-medium break-all text-text">
        {formatValue(setting.resolvedForScope?.value ?? setting.effectiveValue)}
      </dd>
    </div>
    <div>
      <dt class="gm-caption">Code default</dt>
      <!--
        Shown beside the effective value rather than instead of it: the pair is
        what tells an operator whether anything has been decided about this key.
      -->
      <dd class="font-mono font-medium break-all text-text">
        {formatValue(setting.defaultValue)}
      </dd>
    </div>
    <div>
      <dt class="gm-caption">Can be set at</dt>
      <dd class="font-medium text-text">{setting.scopes.join(', ')}</dd>
    </div>
  </dl>

  <div class="grid gap-5 xl:grid-cols-2">
    <div class="min-w-0">
      <SettingForm
        {setting}
        scope={data.scope}
        scopeId={data.scopeId}
        providers={data.providers}
        result={form ?? null}
      />
    </div>

    <div class="min-w-0">
      <SettingHistory {setting} now={data.now} />
    </div>
  </div>
</div>
