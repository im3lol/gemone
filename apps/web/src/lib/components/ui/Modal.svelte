<!--
  Modal — docs/UI_KIT.md, UI_AUDIT.md AD4 / U9.

  Built on the native `<dialog>` element. Included in this phase rather than
  invented later because phases 8 and 9 confirm destructive admin actions —
  suspending a user, rejecting a payout — and those are the actions least
  forgiving of a hand-rolled dialog.

  ## Why native

  `showModal()` gives the focus trap, the Escape key, the inert background and
  the top-layer stacking for free. Every one of those is a defect waiting to
  happen in a `div`-based modal, and three of them are invisible to anyone
  testing with a mouse.

  ## Ownership of `open`

  `open` is `$bindable` and the element's own `close` event writes back to it.
  That matters because the browser can close the dialog without asking — the
  Escape key does — and a component that did not hear about it would leave the
  caller believing a modal is still on screen.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    open?: boolean;
    /** Names the dialog for assistive technology. Required. */
    title: string;
    description?: string;
    class?: string;
    children?: Snippet;
    /** Buttons, aligned to the end. Usually cancel + the real action. */
    footer?: Snippet;
  };

  let { open = $bindable(false), title, description, class: extra = '', children, footer }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  const uid = $props.id();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-description`;

  /*
   * `open` drives the element through its methods, never through the `open`
   * attribute. `<dialog open>` renders a non-modal dialog: no backdrop, no
   * focus trap, no inert page — it looks identical and protects nothing.
   */
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={titleId}
  aria-describedby={description ? descriptionId : undefined}
  class="gm-modal {extra}"
  onclose={() => (open = false)}
>
  <div class="flex flex-col gap-4">
    <div>
      <h2 id={titleId} class="gm-card-title">{title}</h2>
      {#if description}
        <p id={descriptionId} class="gm-subtitle mt-1">{description}</p>
      {/if}
    </div>

    {#if children}
      <div>{@render children()}</div>
    {/if}

    {#if footer}
      <div class="flex flex-wrap items-center justify-end gap-2">
        {@render footer()}
      </div>
    {/if}
  </div>
</dialog>
