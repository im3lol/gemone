<!--
  Field — DESIGN_SYSTEM.md §10.2, docs/UI_KIT.md.

  The label / control / hint / error wrapper. It exists so that the accessible
  wiring is written once: a real `for=`/`id=` pair, `aria-describedby` pointing
  at whichever of hint and error is present, and `aria-invalid` when the field
  has an error.

  Legacy wraps the input inside the `<label>` and never emits a `for=`
  (DS §10.2). That works for a bare input and breaks for anything else — a
  select with a hint, a grouped control, an error message that must be
  announced. This uses explicit ids instead, which is the one place the field
  chrome deliberately departs from legacy's markup while keeping its look.

  `children` receives the ids to put on the control, so any control — including
  ones this kit does not ship yet — can sit inside a Field.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type ControlProps = {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  };

  type Props = {
    label: string;
    /** Falls back to a generated id; pass one only to match an existing DOM. */
    id?: string;
    hint?: string;
    /** Presence marks the field invalid and renders the message as an alert. */
    error?: string;
    required?: boolean;
    /** Hide the label visually but keep it for screen readers. */
    labelHidden?: boolean;
    class?: string;
    children: Snippet<[ControlProps]>;
  };

  let {
    label,
    id: providedId,
    hint,
    error,
    required = false,
    labelHidden = false,
    class: extra = '',
    children,
  }: Props = $props();

  const uid = $props.id();
  const id = $derived(providedId ?? `${uid}-field`);
  const hintId = $derived(`${id}-hint`);
  const errorId = $derived(`${id}-error`);

  // Order matters: the error is read first because it is the thing that needs
  // acting on. A field with both still announces both.
  const describedBy = $derived(
    [error ? errorId : undefined, hint ? hintId : undefined].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="flex flex-col gap-1.5 {extra}">
  <label for={id} class={labelHidden ? 'gm-sr-only' : 'gm-label'}>
    {label}
    {#if required}
      <span aria-hidden="true" class="text-danger-text">*</span>
      <span class="gm-sr-only">(required)</span>
    {/if}
  </label>

  {@render children({ id, describedBy, invalid: Boolean(error) })}

  {#if hint}
    <p id={hintId} class="gm-hint">{hint}</p>
  {/if}

  {#if error}
    <!--
      `role="alert"` so a validation message that appears after a failed submit
      is announced without moving focus.
    -->
    <p id={errorId} role="alert" class="gm-error-text">{error}</p>
  {/if}
</div>
