<!--
  Select — DESIGN_SYSTEM.md §10.1, docs/UI_KIT.md.

  The same field chrome as Input, around a native `<select>`. Native because a
  custom listbox is a keyboard-and-screen-reader project of its own, and every
  select this product needs — status filters, provider pickers, payout methods
  — is a short list of plain strings.

  Options are passed as data rather than as children so that the selected
  value, the labels and the disabled state stay in one place.
-->
<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';

  import Field from './Field.svelte';
  import type { SelectOption } from './types';

  type Props = {
    label: string;
    options: SelectOption[];
    value?: string;
    id?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    labelHidden?: boolean;
    /** Rendered as a disabled, selected first option — not a real choice. */
    placeholder?: string;
    class?: string;
  } & Omit<HTMLSelectAttributes, 'value' | 'id' | 'class' | 'required'>;

  let {
    label,
    options,
    value = $bindable(''),
    id,
    hint,
    error,
    required = false,
    labelHidden = false,
    placeholder,
    class: extra = '',
    ...rest
  }: Props = $props();
</script>

<Field {label} {id} {hint} {error} {required} {labelHidden} class={extra}>
  {#snippet children({ id: controlId, describedBy, invalid })}
    <select
      id={controlId}
      bind:value
      {required}
      aria-describedby={describedBy}
      aria-invalid={invalid ? 'true' : undefined}
      class="gm-field"
      {...rest}
    >
      {#if placeholder}
        <option value="" disabled>{placeholder}</option>
      {/if}
      {#each options as option (option.value)}
        <option value={option.value} disabled={option.disabled}>{option.label}</option>
      {/each}
    </select>
  {/snippet}
</Field>
