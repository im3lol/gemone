<!--
  The decision — ARCHITECTURE.md §11.1, §11.3.

  One `<form>` per transition, each posting to the SvelteKit action named after
  the API endpoint behind it: `?/approve` → `POST /admin/payouts/:id/approve`.
  One name for one edge, all the way through, so there is no table anywhere
  mapping a button to a meaning.

  ## Which buttons exist is the server's decision

  `actionsFor` mirrors `payout-state-machine.ts` and permits nothing: a button
  it renders in error still reaches `assertTransition`, which answers 409 and
  this page shows the message. What it prevents is offering a control that is
  certain to fail — a different job from enforcement, and the only one a
  browser can honestly do.

  A terminal request therefore renders no form at all, only what happened.

  ## Duplicate actions

  Three layers, and only the last one is real:

  1. The submitting form disables its own button and every other form's, so a
     second decision cannot be started while one is open.
  2. On reload, a request that moved on renders different buttons — an
     approved request has no Approve.
  3. **The row lock and the state machine.** Two admins in two tabs both see
     Approve; the second one to post gets a 409, because the transition is
     checked under `SELECT … FOR UPDATE` inside the transaction that moves the
     money. That is the guard; the two above are courtesy.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PayoutStatus } from '@gemone/contracts';

  import { Alert, Button, Card, Input } from '$lib/components/ui';
  import { actionsFor, queueState } from '$lib/admin/payout-queue';

  import type { ReviewResult } from './types';

  type Props = {
    status: PayoutStatus;
    result: ReviewResult | null;
  };

  let { status, result }: Props = $props();

  const actions = $derived(actionsFor(status));
  /*
   * Not `state`: a local named `state` makes `$state(…)` parse as a store
   * subscription on it rather than as the rune, and the failure reads as a
   * type error about stores.
   */
  const current = $derived(queueState(status));

  /** Which action is in flight, or `null`. Disables every form, not just its own. */
  let submitting = $state<string | null>(null);
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="decide-title">
  <div>
    <h2 id="decide-title" class="gm-card-title">
      {actions.length > 0 ? 'Decide' : 'Outcome'}
    </h2>
    <p class="gm-subtitle mt-1">{current.hint}</p>
  </div>

  {#if result?.ok}
    <Alert variant="success" title="Recorded">
      This request is now {queueState(result.status as PayoutStatus).label.toLowerCase()}.
    </Alert>
  {:else if result}
    <!--
      The API's own message. Every reason a transition can be refused lives in
      the state machine and the accounting service; restating any of them here
      would be a second copy of a rule that lives somewhere else.
    -->
    <Alert variant="error" title="That could not be recorded">
      {result.message}
    </Alert>
  {/if}

  {#each actions as item (item.action)}
    <form
      method="POST"
      action="?/{item.action}"
      class="flex flex-col gap-3 border-t border-border pt-4 first-of-type:border-t-0 first-of-type:pt-0"
      use:enhance={({ cancel }) => {
        if (submitting) return cancel();
        submitting = item.action;

        return async ({ update }) => {
          submitting = null;
          // The default: apply the result and re-run every load, which is what
          // refreshes the status, the buttons and the account's balances.
          await update();
        };
      }}
    >
      {#if item.field}
        <Input
          label={item.field.label}
          name={item.field.name}
          hint={item.field.hint}
          required={!item.field.label.toLowerCase().includes('optional')}
          maxlength={item.field.name === 'reason' ? 500 : 200}
          autocomplete="off"
        />
      {/if}

      <Button
        type="submit"
        variant={item.variant}
        loading={submitting === item.action}
        disabled={submitting !== null}
      >
        {submitting === item.action ? 'Recording…' : item.label}
      </Button>
    </form>
  {/each}
</Card>
