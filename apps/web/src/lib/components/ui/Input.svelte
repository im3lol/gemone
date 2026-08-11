<!--
  Input — DESIGN_SYSTEM.md §10.1, docs/UI_KIT.md.

  A labelled text control. Everything accessible about it lives in Field; this
  supplies the control and the field chrome.

  `type` is constrained to the text-like set on purpose. Checkboxes and radios
  need a different layout — control before label, no full-width box — and
  letting them through here would produce something that looks like a text
  field and behaves like neither.
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  import Field from './Field.svelte';

  type TextLike = 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'url' | 'date';

  type Props = {
    label: string;
    type?: TextLike;
    value?: string | number | null;
    id?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    labelHidden?: boolean;
    /** Class for the wrapper, not the control — layout belongs to the field. */
    class?: string;
  } & Omit<HTMLInputAttributes, 'type' | 'value' | 'id' | 'class' | 'required'>;

  let {
    label,
    type = 'text',
    value = $bindable(),
    id,
    hint,
    error,
    required = false,
    labelHidden = false,
    class: extra = '',
    ...rest
  }: Props = $props();

  /*
   * Written by hand rather than with `bind:value`, because Svelte refuses a
   * two-way binding on an input whose `type` is dynamic — and a component
   * whose whole job is to take a `type` prop has no static one to offer. The
   * assignment below still reaches the caller: `value` is `$bindable`.
   */
  function sync(event: Event & { currentTarget: HTMLInputElement }): void {
    if (type === 'number') {
      const next = event.currentTarget.valueAsNumber;
      value = Number.isNaN(next) ? null : next;
      return;
    }
    value = event.currentTarget.value;
  }
</script>

<Field {label} {id} {hint} {error} {required} {labelHidden} class={extra}>
  {#snippet children({ id: controlId, describedBy, invalid })}
    <input
      id={controlId}
      {type}
      {required}
      value={value ?? ''}
      oninput={sync}
      aria-describedby={describedBy}
      aria-invalid={invalid ? 'true' : undefined}
      class="gm-field"
      {...rest}
    />
  {/snippet}
</Field>
