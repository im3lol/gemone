<!--
  Changing one value — P3, ARCHITECTURE.md §4.9.

  ## The control is chosen by the key's declared type, not by its name

  `valueType` is on every key's registration and comes back on every response,
  so a boolean gets a two-option select, a number gets a numeric field, and the
  two keys holding arrays get a textarea with their JSON in it. There is no
  table here mapping `payouts.currency` to a control — that table is the second
  declaration of keys this whole screen exists to avoid.

  What a value may *be* is the Zod schema registered with the key, and it is
  not restated here: the hold period's `min(0).max(180)` lives in
  `rewards.config.ts`, and the API's refusal is what an operator reads. A copy
  of that range in this file would be the copy no test runs against a real
  write.

  ## Two warnings, both read from the API rather than assigned here

  **Provider overrides.** A provider-scoped row wins over the global one, so
  saving here changes the value for everyone *except* the providers an operator
  is most likely to be thinking about. The count comes from the API.

  **Leaving the default.** A key with nothing stored follows code, and the
  first write is a decision to stop tracking it. `source === 'default'` is the
  API's own statement of that, which §4.9 exists to surface.

  ## After a refusal, the form still holds what was typed

  A settings form that clears itself makes an operator retype a JSON array to
  find out what was wrong with it the second time. The action returns the
  submitted value and reason, and they win over the stored ones.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type {
    AdminConfigurationKeyDetail,
    ConfigScopeName,
    ProviderSummary,
  } from '@gemone/contracts';

  import { Alert, Button, Card, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { sourceState, toInputValue, versionFor, versionToField } from '$lib/admin/settings';

  import type { SettingActionResult } from './types';

  type Props = {
    setting: AdminConfigurationKeyDetail;
    /** Which row is being edited — GLOBAL, or one provider's override. */
    scope: ConfigScopeName;
    /** The provider whose override this is, or `''` for the global value. */
    scopeId: string;
    /** Providers to choose between. Empty when the key is global-only. */
    providers: ProviderSummary[];
    result: SettingActionResult | null;
  };

  let { setting, scope, scopeId, providers, result }: Props = $props();

  const perProvider = $derived(scope === 'PROVIDER');

  /*
   * The row being edited, which is not always the row in force.
   *
   * At provider scope the box shows *that provider's stored value* if it has
   * one, and falls back to what the provider currently resolves to — the value
   * an operator would be changing away from. Showing the global value in a
   * provider's box would invite them to "confirm" a number that is not this
   * provider's.
   */
  const storedHere = $derived(
    setting.overrides.find(
      (override) => override.scope === scope && override.scopeId === scopeId,
    )?.value,
  );

  const source = $derived(
    sourceState(perProvider ? (setting.resolvedForScope?.source ?? setting.source) : setting.source),
  );

  /** Nothing stored at *this* scope — so there is nothing for a reset to remove. */
  const isDefault = $derived(storedHere === undefined);

  /*
   * The version this render was built from — TODO T88.
   *
   * Taken from the loaded key, so it changes whenever the page is loaded and
   * cannot be re-derived at submit time. That is what makes it an assertion
   * about what the *operator* saw rather than about what the server holds.
   */
  const version = $derived(versionToField(versionFor(setting, scopeId)));

  /*
   * What the box shows: what was submitted if a write was refused, otherwise
   * the value in force. `result.value` is only non-empty on a failure — a
   * success clears it, because the stored value has moved on.
   */
  const inForce = $derived(
    perProvider ? (setting.resolvedForScope?.value ?? setting.effectiveValue) : setting.effectiveValue,
  );

  const shown = $derived(
    result && !result.ok && result.value !== ''
      ? result.value
      : toInputValue(storedHere ?? inForce, setting.valueType),
  );

  const booleanOptions: SelectOption[] = [
    { value: 'true', label: 'On (true)' },
    { value: 'false', label: 'Off (false)' },
  ];

  let submitting = $state<string | null>(null);
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="edit-title">
  <div>
    <h2 id="edit-title" class="gm-card-title">
      {perProvider ? 'Change this provider’s value' : 'Change the global value'}
    </h2>
    <p class="gm-subtitle mt-1">{source.hint}</p>
  </div>

  {#if providers.length > 0}
    <!--
      Which row is being edited — TODO T87.

      Links rather than a select, so the scope is in the URL: "the hold period
      for this provider" is then a thing an operator can bookmark and the Back
      button leaves the scope. It is also what stops a reload landing somebody
      on a different scope from the one they were reading.
    -->
    <nav aria-label="Configuration scope" class="flex flex-wrap gap-2">
      <a
        href="/admin/settings/{encodeURIComponent(setting.key)}"
        aria-current={perProvider ? undefined : 'page'}
        class="gm-btn gm-btn--sm {perProvider ? 'gm-btn--secondary' : 'gm-btn--primary'}"
      >
        Global
      </a>
      {#each providers as provider (provider.id)}
        {@const stored = setting.overrides.some((o) => o.scopeId === provider.id)}
        <a
          href="/admin/settings/{encodeURIComponent(setting.key)}?scopeId={provider.id}"
          aria-current={scopeId === provider.id ? 'page' : undefined}
          class="gm-btn gm-btn--sm {scopeId === provider.id
            ? 'gm-btn--primary'
            : 'gm-btn--secondary'}"
        >
          {provider.displayName}{stored ? ' ·' : ''}
        </a>
      {/each}
    </nav>

    {#if perProvider}
      <p class="gm-caption">
        A value stored here wins over the global one for this provider only. Everything else keeps
        following the global value.
      </p>
    {/if}
  {/if}

  {#if result?.ok}
    <Alert variant="success" title="Recorded">{result.message}</Alert>
  {:else if result?.stale}
    <!--
      Somebody else changed this key while this page was open — TODO T88. Its
      own state rather than a variant of the error below, because the recovery
      is different: nothing about what was typed is wrong, and the fix is to
      look at the value that is there now. Reloading is a link rather than an
      automatic refresh, because discarding what an operator typed without
      asking is the other way to lose a change.
    -->
    <Alert variant="warning" title="This setting changed while you were editing">
      {result.message}
      <p class="mt-3">
        <a href="/admin/settings/{encodeURIComponent(setting.key)}" data-sveltekit-reload>
          Reload this setting
        </a>
      </p>
    </Alert>
  {:else if result}
    <!--
      The API's own message — for a value, that is the key's own schema
      speaking, which is the only place the rule is written.
    -->
    <Alert variant="error" title="That could not be saved">{result.message}</Alert>
  {/if}

  {#if setting.overrideCount > 0 && !perProvider}
    <Alert variant="warning" title="Some providers will not see this change">
      {setting.overrideCount}
      provider{setting.overrideCount === 1 ? ' has' : 's have'} their own value for this setting, and
      a provider value wins over the global one. Those are listed below.
    </Alert>
  {/if}

  <form
    method="POST"
    action="?/set"
    class="flex flex-col gap-4"
    use:enhance={({ cancel }) => {
      if (submitting) return cancel();
      submitting = 'set';

      return async ({ update }) => {
        submitting = null;
        // The default: apply the result and re-run the load, which refreshes
        // the stored value, the source badge and the timeline.
        await update();
      };
    }}
  >
    <!-- The control's type travels with the submission so the action can convert. -->
    <input type="hidden" name="valueType" value={setting.valueType} />
    <!--
      And the version this page was rendered from, so the API can refuse a
      write made from a value somebody else has already replaced.
    -->
    <input type="hidden" name="expectedUpdatedAt" value={version} />
    <!-- Empty for the global row; a provider id when editing one override. -->
    <input type="hidden" name="scopeId" value={scopeId} />

    {#if setting.valueType === 'boolean'}
      <Select
        label="Value"
        name="value"
        options={booleanOptions}
        value={shown}
        hint={setting.description}
      />
    {:else if setting.valueType === 'json'}
      <div class="flex flex-col gap-1.5">
        <label for="setting-value" class="gm-label">
          Value <span class="text-danger-500">*</span>
        </label>
        <p id="setting-value-hint" class="gm-caption">{setting.description}</p>
        <textarea
          id="setting-value"
          name="value"
          rows="6"
          required
          spellcheck="false"
          aria-describedby="setting-value-hint"
          class="gm-input font-mono text-sm"
          value={shown}
        ></textarea>
      </div>
    {:else}
      <Input
        label="Value"
        name="value"
        type={setting.valueType === 'number' ? 'number' : 'text'}
        value={shown}
        hint={setting.description}
        required
        autocomplete="off"
        step={setting.valueType === 'number' ? 'any' : undefined}
      />
    {/if}

    <Input
      label="Why are you changing it?"
      name="reason"
      value={result && !result.ok ? result.reason : ''}
      hint="Recorded against this key permanently. It is the only part of the record a person writes."
      placeholder="Reason"
      required
      minlength={3}
      maxlength={500}
      autocomplete="off"
    />

    <div class="flex flex-wrap gap-3">
      <Button type="submit" loading={submitting === 'set'} disabled={submitting !== null}>
        {submitting === 'set' ? 'Saving…' : 'Save value'}
      </Button>
    </div>
  </form>

  <!--
    Reset is not "set it back to the default", and the difference is §4.9's:
    a reset leaves nothing stored, so the key follows code again and a release
    can move it. Writing today's default explicitly would freeze it as a
    decision nobody made.
  -->
  <form
    method="POST"
    action="?/reset"
    class="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
    use:enhance={({ cancel }) => {
      if (submitting) return cancel();
      submitting = 'reset';

      return async ({ update }) => {
        submitting = null;
        await update();
      };
    }}
  >
    <input type="hidden" name="expectedUpdatedAt" value={version} />
    <input type="hidden" name="scopeId" value={scopeId} />

    <Input
      label={perProvider ? 'Remove this provider’s value' : 'Remove the stored value'}
      name="reason"
      hint={isDefault
        ? 'Nothing is stored at this scope, so there is nothing to remove.'
        : perProvider
          ? 'This provider follows the global value again.'
          : 'The key follows the code default again, and a release can change it.'}
      placeholder="Why?"
      required
      minlength={3}
      maxlength={500}
      autocomplete="off"
      class="flex-1"
    />

    <Button
      type="submit"
      variant="secondary"
      loading={submitting === 'reset'}
      disabled={submitting !== null || isDefault}
    >
      {submitting === 'reset' ? 'Removing…' : perProvider ? 'Remove override' : 'Reset to default'}
    </Button>
  </form>
</Card>
