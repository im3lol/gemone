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
  import type { AdminConfigurationKeyDetail } from '@gemone/contracts';

  import { Alert, Button, Card, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { sourceState, toInputValue } from '$lib/admin/settings';

  import type { SettingActionResult } from './types';

  type Props = {
    setting: AdminConfigurationKeyDetail;
    result: SettingActionResult | null;
  };

  let { setting, result }: Props = $props();

  const source = $derived(sourceState(setting.source));
  const isDefault = $derived(setting.source === 'default');

  /*
   * What the box shows: what was submitted if a write was refused, otherwise
   * the value in force. `result.value` is only non-empty on a failure — a
   * success clears it, because the stored value has moved on.
   */
  const shown = $derived(
    result && !result.ok && result.value !== ''
      ? result.value
      : toInputValue(setting.effectiveValue, setting.valueType),
  );

  const booleanOptions: SelectOption[] = [
    { value: 'true', label: 'On (true)' },
    { value: 'false', label: 'Off (false)' },
  ];

  let submitting = $state<string | null>(null);
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="edit-title">
  <div>
    <h2 id="edit-title" class="gm-card-title">Change the global value</h2>
    <p class="gm-subtitle mt-1">{source.hint}</p>
  </div>

  {#if result?.ok}
    <Alert variant="success" title="Recorded">{result.message}</Alert>
  {:else if result}
    <!--
      The API's own message — for a value, that is the key's own schema
      speaking, which is the only place the rule is written.
    -->
    <Alert variant="error" title="That could not be saved">{result.message}</Alert>
  {/if}

  {#if setting.overrideCount > 0}
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
    <Input
      label="Remove the stored value"
      name="reason"
      hint={isDefault
        ? 'Nothing is stored globally for this key, so there is nothing to remove.'
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
      {submitting === 'reset' ? 'Removing…' : 'Reset to default'}
    </Button>
  </form>
</Card>
