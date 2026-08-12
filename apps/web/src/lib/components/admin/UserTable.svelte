<!--
  The accounts table — DESIGN_SYSTEM.md §12, ARCHITECTURE.md §8.4.

  A real `<table>`: this is a list whose columns are compared down the page,
  and `<th scope="col">` is what lets a screen reader say "Status, Suspended"
  instead of reading a row as a run-on sentence.

  ## What is on it, and what is deliberately not

  The address is here because it is how an operator finds an account — a
  support ticket arrives with an email, not a UUID. `AdminUserSummary` is an
  allowlist (`UsersService.toAdminSummary`) that already excludes the password
  hash, the TOTP secret and the registration IP; "admin" is not a reason to
  serialise secrets, and this table adds nothing the list response did not
  already contain.

  **No balance column.** No admin endpoint returns an arbitrary user's buckets,
  and a number summed from somewhere else would be a balance that disagrees
  with the ledger (TODO T84).

  ## One table, not two layouts

  Below `md` the table keeps **Account** and **Status** and moves the rest into
  the first cell. Same DOM, same rows, no second markup tree, and no table
  scrolling sideways.
-->
<script lang="ts">
  import type { AdminUserSummary } from '@gemone/contracts';

  import { Badge, Button } from '$lib/components/ui';
  import { roleLabel, shortId, userState } from '$lib/admin/users';
  import { absoluteDate, relativeTime } from '$lib/rewards/ledger';

  type Props = {
    items: AdminUserSummary[];
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
  };

  let { items, now }: Props = $props();
</script>

<table class="gm-table">
  <thead>
    <tr>
      <th scope="col">Account</th>
      <th scope="col" class="hidden md:table-cell">Role</th>
      <th scope="col" class="hidden md:table-cell">Registered</th>
      <th scope="col" class="hidden lg:table-cell gm-num">Sessions</th>
      <th scope="col">Status</th>
      <th scope="col"><span class="gm-sr-only">Open</span></th>
    </tr>
  </thead>

  <tbody>
    {#each items as user (user.id)}
      {@const state = userState(user.status)}
      <tr>
        <td>
          <p class="font-medium break-all text-text">{user.email}</p>
          <p class="gm-caption font-mono" title={user.id}>{shortId(user.id)}</p>

          <!-- The columns that leave the table below `md`. -->
          <p class="mt-1 flex flex-wrap items-center gap-2 md:hidden">
            <span class="text-xs text-text-secondary">{roleLabel(user.role)}</span>
            <time class="text-xs text-text-muted" datetime={user.createdAt}>
              {relativeTime(user.createdAt, now)}
            </time>
          </p>

          {#if user.emailVerifiedAt === null}
            <!--
              A fact from the record, not a judgement: the address has not been
              confirmed. It is on the summary, and it is the first thing asked
              about an account that cannot receive a reset link.
            -->
            <p class="gm-caption">Email not verified</p>
          {/if}
        </td>

        <td class="hidden md:table-cell">{roleLabel(user.role)}</td>

        <td class="hidden whitespace-nowrap md:table-cell">
          <time datetime={user.createdAt} title={absoluteDate(user.createdAt)}>
            {relativeTime(user.createdAt, now)}
          </time>
        </td>

        <td class="hidden lg:table-cell gm-num">{user.activeSessionCount}</td>

        <td><Badge variant={state.tone}>{state.label}</Badge></td>

        <td>
          <Button href="/admin/users/{user.id}" variant="secondary" size="sm">Open</Button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
