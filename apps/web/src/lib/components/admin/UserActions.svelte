<!--
  What an administrator may do to an account — ARCHITECTURE.md §8.4.

  Three things, because the API offers three: change the standing
  (`PATCH /admin/users/:id/status`), change the role
  (`PATCH /admin/users/:id/role`), and end every session
  (`POST /admin/users/:id/revoke-sessions`). All three require a reason of at
  least eight characters, enforced by the API and marked required here.

  ## Two cards, because they are two decisions

  The standing is about whether an account may act at all; the role is about
  what it may reach. Putting the promotion under a heading that says "Standing"
  would make appointing an administrator look like a variety of suspension, and
  the reason box beneath it is the one an operator is asked to justify — so the
  two are separated, and the role card carries its own copy about what a
  demotion does *not* do (T85).

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
  import {
    roleChangeFor,
    roleLabel,
    statusChangesFor,
    statusVariant,
    statusVerb,
    userState,
  } from '$lib/admin/users';

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
  const roleChange = $derived(roleChangeFor(account.role));

  /** Which action is in flight, or `null`. Disables every form, not just its own. */
  let submitting = $state<string | null>(null);
</script>

<div class="flex flex-col gap-5">
<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="actions-title">
  <div>
    <h2 id="actions-title" class="gm-card-title">Standing</h2>
    <p class="gm-subtitle mt-1">{current.hint}</p>
  </div>

  <!--
    Only this card's own outcomes. A refused promotion announced above the
    suspension buttons would read as a refused suspension.
  -->
  {#if result && result.action !== 'role'}
    {#if result.ok}
      <Alert variant="success" title="Recorded">{result.message}</Alert>
    {:else}
      <!--
        The API's own message. Every rule about what a status change requires
        lives in `UpdateUserStatusDto` and `AdminUsersService`; restating one
        here would be a second copy of a rule that lives somewhere else.
      -->
      <Alert variant="error" title="That could not be recorded">{result.message}</Alert>
    {/if}
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

<!--
  The role — TODO T85, ARCHITECTURE.md §8.4.

  One button, because there are two roles and the account holds one of them.
  What the change is called and what it does come from `$lib/admin/users.ts`;
  whether it is permitted comes from the API, which refuses an administrator
  changing their own role and refuses any change that would leave nobody able
  to administer the platform.
-->
<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="role-title">
  <div>
    <h2 id="role-title" class="gm-card-title">Role</h2>
    <p class="gm-subtitle mt-1">
      This account is {roleLabel(account.role).toLowerCase()}-level. §8.4: administrators are
      provisioned by a seed script or by an existing administrator — never by signing up.
    </p>
  </div>

  {#if result?.action === 'role'}
    {#if result.ok}
      <Alert variant="success" title="Recorded">{result.message}</Alert>
    {:else}
      <Alert variant="error" title="That could not be recorded">{result.message}</Alert>
    {/if}
  {/if}

  {#if self}
    <Alert variant="info" title="This is your own account">
      An administrator cannot change their own role. It is the more final half of the same
      rule that protects the standing: another administrator can reinstate a suspended one,
      and nobody can appoint themselves back.
    </Alert>
  {:else if !roleChange}
    <!-- A role this build has no words for. Better than a button labelled with a guess. -->
    <p class="gm-caption">
      This account holds a role this version does not recognise, so no change is offered.
    </p>
  {:else}
    <form
      method="POST"
      action="?/role"
      class="flex flex-col gap-2 sm:flex-row sm:items-end"
      use:enhance={({ cancel }) => {
        if (submitting) return cancel();
        submitting = 'role';

        return async ({ update }) => {
          submitting = null;
          // Re-runs the load, which is what refreshes the badge in the header
          // and the button this form is made of.
          await update();
        };
      }}
    >
      <input type="hidden" name="role" value={roleChange.to} />

      <Input
        label={roleChange.verb}
        name="reason"
        hint={roleChange.hint}
        placeholder="Why?"
        required
        maxlength={500}
        autocomplete="off"
        class="flex-1"
      />

      <Button
        type="submit"
        variant={roleChange.variant}
        loading={submitting === 'role'}
        disabled={submitting !== null}
      >
        {submitting === 'role' ? 'Recording…' : roleChange.verb}
      </Button>
    </form>
  {/if}
</Card>
</div>
