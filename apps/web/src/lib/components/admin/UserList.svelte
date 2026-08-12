<!--
  The accounts panel — filters, table, pager, and all four of its states.

  The same shape as every streamed panel since the dashboard (D83): it takes a
  **promise** the page streams from its `load`, and owns loading / empty /
  error / populated itself. The filters stay usable while the list is open, and
  an `/admin/users` that fails is a panel that says so rather than a page that
  logs the administrator out of the tool they were investigating with.

  ## Two empty states, because they mean different things

  "No accounts yet" is a fresh deployment. "Nothing matches this search" is an
  operator who typed an address that does not exist — usually a typo in a
  support ticket — and what they need is the search cleared, not the news that
  the platform has no users.
-->
<script lang="ts">
  import Users from '@lucide/svelte/icons/users';
  import type { UserRole, UserStatus } from '@gemone/contracts';

  import { Button, Card, EmptyState, ErrorState, Pager, Skeleton } from '$lib/components/ui';
  import { roleLabel, statusLabel } from '$lib/admin/users';

  import UserFilters from './UserFilters.svelte';
  import UserTable from './UserTable.svelte';
  import type { UserListResult } from './types';

  type Props = {
    users: Promise<UserListResult>;
    now: string;
    status: UserStatus | '';
    role: UserRole | '';
    email: string;
    offset: number;
    pageSize: number;
    query: string;
  };

  let { users, now, status, role, email, offset, pageSize, query }: Props = $props();

  const params = $derived(new URLSearchParams(query));

  /*
   * What was asked for, in the words the controls used — so "no results" can
   * be "no results *for this*", which tells an operator which control to
   * change.
   */
  const applied = $derived(
    [
      email ? `“${email}”` : '',
      status ? statusLabel(status) : '',
      role ? roleLabel(role) : '',
    ].filter(Boolean),
  );
</script>

<Card as="section" padding="lg" aria-labelledby="accounts-title">
  <div class="flex flex-col gap-4">
    <div>
      <h2 id="accounts-title" class="gm-card-title">Accounts</h2>
      <p class="gm-subtitle mt-1">Newest first. Open one to change its standing.</p>
    </div>

    <UserFilters {status} {role} {email} />
  </div>

  <div class="mt-5">
    {#await users}
      <div aria-busy="true" aria-live="polite" class="flex flex-col gap-4">
        <span class="gm-sr-only">Loading accounts</span>
        {#each [0, 1, 2, 3, 4, 5] as row (row)}
          <div class="flex items-center gap-3">
            <div class="flex-1"><Skeleton lines={2} height="0.75rem" /></div>
            <Skeleton width="5rem" height="0.875rem" />
            <Skeleton width="4rem" height="2rem" />
          </div>
        {/each}
      </div>
    {:then page}
      {#if !page.ok}
        <ErrorState
          title="The accounts list could not be loaded"
          description="No account has changed. Refresh the page to try again."
        />
      {:else if page.items.length === 0 && applied.length > 0}
        <EmptyState
          icon={Users}
          title="No accounts match this search"
          description="Nothing on the platform matches {applied.join(' and ')}."
        >
          {#snippet action()}
            <Button href="/admin/users" variant="secondary" size="sm">Clear the filters</Button>
          {/snippet}
        </EmptyState>
      {:else if page.items.length === 0}
        <EmptyState
          icon={Users}
          title="No accounts yet"
          description="Everyone who registers appears here, with their standing and their sessions."
        />
      {:else}
        <UserTable items={page.items} {now} />

        <Pager
          {offset}
          {pageSize}
          total={page.total}
          query={params}
          base="/admin/users"
          label="Account pages"
        />
      {/if}
    {/await}
  </div>
</Card>
