<!--
  What an administrator may do to an account — ARCHITECTURE.md §8.4.

  Two things, because the API offers two: change the standing
  (`PATCH /admin/users/:id/status`) and end every session
  (`POST /admin/users/:id/revoke-sessions`). Both require a reason of at least
  eight characters, enforced by the API and marked required here.

  ## One form per status, named after the transition

  `?/status` with a hidden `status` field rather than a select-and-submit, so
  each button is a single unambiguous act with its own confirmation copy. The
  status the account already holds is not offered — a button whose success is
  indistinguishable from doing nothing.

  **There is no state machine behind these.** `UpdateUserStatusDto` accepts any
  status after any other, deliberately: an account banned in error has to be
  reachable again. `$lib/admin/users.ts` says why at more length.

  ## Changing a standing ends the sessions, and says so

  `AdminUsersService.setStatus` revokes every refresh token in the same
  transaction whenever the new status is not `ACTIVE`. The separate revoke
  action exists for the other case — a session believed compromised while the
  account itself is fine — and the copy keeps them apart, because an operator
  choosing between them is choosing what they believe about the account.

  ## The admin's own account

  `setStatus` refuses `targetUserId === adminId` with a 403. This panel says so
  instead of rendering controls that are certain to fail; the API is still the
  control, and the revoke action stays available because that one is permitted.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { AdminUserSummary } from '@gemone/contracts';

  import { Alert, Button, Card, Input } from '$lib/components/ui';
  import { statusChangesFor, statusVariant, statusVerb, userState } from '$lib/admin/users';

  import type { UserActionResult } from './types';

  type Props = {
    account: AdminUserSummary;
    /** True when the administrator is looking at their own account. */
    self: boolean;
    result: UserActionResult | null;
  };

  let { account, self, result }: Props = $props();

  const current = $derived(userState(account.status));
  const changes = $derived(statusChangesFor(account.status));

  /** Which action is in flight, or `null`. Disables every form, not just its own. */
  let submitting = $state<string | null>(null);
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="actions-title">
  <div>
    <h2 id="actions-title" class="gm-card-title">Standing</h2>
    <p class="gm-subtitle mt-1">{current.hint}</p>
  </div>

  {#if result?.ok}
    <Alert variant="success" title="Recorded">{result.message}</Alert>
  {:else if result}
    <!--
      The API's own message. Every rule about what a status change requires
      lives in `UpdateUserStatusDto` and `AdminUsersService`; restating one
      here would be a second copy of a rule that lives somewhere else.
    -->
    <Alert variant="error" title="That could not be recorded">{result.message}</Alert>
  {/if}

  {#if self}
    <Alert variant="info" title="This is your own account">
      An administrator cannot change their own standing — on a single-admin
      deployment that is unrecoverable without database access. Sessions can
      still be ended below.
    </Alert>
  {:else}
    {#each changes as status (status)}
      <form
        method="POST"
        action="?/status"
        class="flex flex-col gap-2 border-t border-border pt-4 first-of-type:border-t-0 first-of-type:pt-0 sm:flex-row sm:items-end"
        use:enhance={({ cancel }) => {
          if (submitting) return cancel();
          submitting = `status:${status}`;

          return async ({ update }) => {
            submitting = null;
            // The default: apply the result and re-run the load, which is what
            // refreshes the status, the buttons and the session count.
            await update();
          };
        }}
      >
        <input type="hidden" name="status" value={status} />

        <Input
          label="{statusVerb(status)} this account"
          name="reason"
          hint={userState(status).hint}
          placeholder="Why?"
          required
          maxlength={500}
          autocomplete="off"
          class="flex-1"
        />

        <Button
          type="submit"
          variant={statusVariant(status)}
          loading={submitting === `status:${status}`}
          disabled={submitting !== null}
        >
          {submitting === `status:${status}` ? 'Recording…' : statusVerb(status)}
        </Button>
      </form>
    {/each}
  {/if}

  <form
    method="POST"
    action="?/revoke"
    class="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end"
    use:enhance={({ cancel }) => {
      if (submitting) return cancel();
      submitting = 'revoke';

      return async ({ update }) => {
        submitting = null;
        await update();
      };
    }}
  >
    <Input
      label="End every session"
      name="reason"
      hint="For a session believed compromised while the account itself is fine. The standing does not change and the user can sign in again."
      placeholder="Why?"
      required
      maxlength={500}
      autocomplete="off"
      class="flex-1"
    />

    <Button
      type="submit"
      variant="secondary"
      loading={submitting === 'revoke'}
      disabled={submitting !== null}
    >
      {submitting === 'revoke' ? 'Recording…' : 'End sessions'}
    </Button>
  </form>
</Card>
