<!--
  Platform settings — P3, PROJECT.md §3.2.

  *"Adjust reward rates, hold periods, withdrawal limits, daily limits, fraud
  thresholds, currencies — without a developer."* Thirty keys across seven
  namespaces have been database rows since the features that introduced them,
  reachable only by a hand-written `PUT` until this screen.

  Deliberately **not** a curated settings page with sections somebody wrote by
  hand. The list is whatever the API says is registered, grouped by the
  namespace each key declares — so the screen is already correct for the next
  key somebody adds.
-->
<script lang="ts">
  import { SettingsList } from '$lib/components/admin';
  import { PageHeader } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head><title>Settings · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Settings"
    description="Values the platform reads at runtime, and where each one currently comes from."
  />

  <SettingsList
    settings={data.settings}
    search={data.search}
    overriddenOnly={data.overriddenOnly}
  />
</div>
