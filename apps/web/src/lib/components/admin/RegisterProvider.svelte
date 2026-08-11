<!--
  Registering a provider — ARCHITECTURE.md §7.3, §7.4.

  Two fields, because that is what `POST /admin/providers` takes: a slug that
  **must match an adapter registered in the build**, and a name to call it.
  The slug is therefore a choice from a list, not free text — `GET
  /admin/providers/adapters` reports what this build can support, and offering
  anything else would offer a request the API will refuse.

  This is not the configuration wizard §7.4 would need for a real onboarding.
  It exists because the alternative is what every phase before this one did:
  register the provider with a hand-written API call. A screen that manages
  providers but cannot create one leaves the first step of the operator's job
  outside the product.

  ## Credentials are not here, and cannot be

  An adapter's secrets come from the environment (§7.2 rule 3), never from a
  row and never from a form. `requiredCredentialVariables` names the variables
  an adapter needs — names only, never values (§19.3) — so an operator can see
  what to set before registering, and see why registration failed if they did
  not.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import Plus from '@lucide/svelte/icons/plus';
  import type { ProviderCapabilityReport } from '@gemone/contracts';

  import { Alert, Badge, Button, Card, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { capabilityLabel } from '$lib/admin/providers';

  type Props = {
    /** Adapters this build ships, whether or not a row exists for them. */
    adapters: ProviderCapabilityReport[];
    /** Slugs that already have a row — they cannot be registered twice. */
    registeredSlugs: string[];
    busy: string | null;
    onbusy: (action: string | null) => void;
  };

  let { adapters, registeredSlugs, busy, onbusy }: Props = $props();

  const available = $derived(adapters.filter((a) => !registeredSlugs.includes(a.slug)));

  const options = $derived<SelectOption[]>(
    available.map((adapter) => ({
      value: adapter.slug,
      label: `${adapter.displayName} (${adapter.slug})`,
      // An adapter whose environment is incomplete can still be registered —
      // the row is valid and the registry reports the reason — but choosing it
      // knowingly is better than discovering it afterwards.
      disabled: false,
    })),
  );

  let slug = $state('');

  const chosen = $derived(available.find((adapter) => adapter.slug === slug));
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="register-title">
  <div>
    <h2 id="register-title" class="gm-card-title">Register a provider</h2>
    <p class="gm-subtitle mt-1">
      Only adapters this build ships can be registered. Everything else about a provider —
      its rules, its rate, its credentials — lives in configuration and the environment.
    </p>
  </div>

  {#if adapters.length === 0}
    <Alert variant="warning" title="This build ships no provider adapters" live={false}>
      Nothing can be registered until an adapter exists in the code.
    </Alert>
  {:else if available.length === 0}
    <Alert variant="info" title="Every adapter in this build is already registered" live={false}>
      {adapters.map((adapter) => adapter.slug).join(', ')}
    </Alert>
  {:else}
    <form
      method="POST"
      action="?/register"
      class="flex flex-col gap-3"
      use:enhance={({ cancel }) => {
        if (busy) return cancel();
        onbusy('register');

        return async ({ update }) => {
          await update({ reset: false });
          onbusy(null);
        };
      }}
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          label="Adapter"
          name="slug"
          bind:value={slug}
          options={options}
          placeholder="Choose an adapter"
          required
          class="sm:flex-1"
        />

        <Input
          label="Display name"
          name="displayName"
          required
          maxlength={100}
          autocomplete="off"
          hint="What operators and users see."
          class="sm:flex-1"
        />

        <Button type="submit" loading={busy === 'register'} disabled={busy !== null}>
          <Plus size={16} aria-hidden="true" />
          Register
        </Button>
      </div>

      {#if chosen}
        <div class="flex flex-col gap-2 border-t border-border pt-3">
          <p class="flex flex-wrap items-center gap-1">
            <span class="gm-caption mr-1">Capabilities</span>
            {#each chosen.capabilities as capability (capability)}
              <Badge variant="info">{capabilityLabel(capability)}</Badge>
            {/each}
          </p>

          {#if chosen.requiredCredentialVariables.length > 0}
            <p class="gm-caption">
              Needs these environment variables set:
              <span class="font-mono">{chosen.requiredCredentialVariables.join(', ')}</span>
            </p>
          {/if}

          {#if !chosen.registered}
            <Alert variant="warning" title="This adapter is not live in the running process">
              {chosen.registrationError ?? 'Its environment is incomplete.'} You can register it,
              and it stays inert until the variables above are set.
            </Alert>
          {/if}
        </div>
      {/if}
    </form>
  {/if}
</Card>
