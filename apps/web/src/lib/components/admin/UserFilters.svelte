<!--
  The accounts filter bar — status, role, and a search on the address.

  All three are the API's own parameters (`ListUsersDto`), forwarded rather
  than applied here, so the count under the table is the count of what matched.

  ## Why a GET form and not client state

  The result is a URL. `?status=SUSPENDED&email=example` is bookmarkable —
  "the suspended accounts" is a link an operator can keep — survives a reload,
  and is what the Back button undoes. None of that is true of state held in a
  component, and none of it needs JavaScript.

  **`offset` is deliberately not carried.** Changing a filter changes the
  result set, and page 3 of the old one is usually past the end of the new one,
  which renders an empty page that reads as "there is nothing here".

  ## The search is a text field, not an email field

  `type="email"` would make the browser refuse "p11" before the form was ever
  submitted, which is the same mistake the API made until this phase: the
  parameter is a *fragment* matched with `contains`, and a whole address is the
  case a search box is least needed for. The two selects submit on change; the
  text field does not, because submitting on every keystroke is a navigation
  per character.
-->
<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import type { UserRole, UserStatus } from '@gemone/contracts';

  import { Button, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import {
    USER_ROLES_IN_ORDER,
    USER_STATUSES_IN_ORDER,
    roleLabel,
    statusLabel,
  } from '$lib/admin/users';

  type Props = {
    /** The active status, or `''` for every status. */
    status: UserStatus | '';
    /** The active role, or `''` for both. */
    role: UserRole | '';
    /** The active search fragment, or `''`. */
    email: string;
  };

  let { status, role, email }: Props = $props();

  const statusOptions: SelectOption[] = [
    { value: '', label: 'Any status' },
    ...USER_STATUSES_IN_ORDER.map((value) => ({ value, label: statusLabel(value) })),
  ];

  const roleOptions: SelectOption[] = [
    { value: '', label: 'Any role' },
    ...USER_ROLES_IN_ORDER.map((value) => ({ value, label: roleLabel(value) })),
  ];
</script>

<form method="GET" class="flex flex-wrap items-end gap-3">
  <Input
    label="Search by email"
    name="email"
    value={email}
    placeholder="Any part of an address"
    hint="Matches anywhere in the address."
    maxlength={320}
    autocomplete="off"
    class="min-w-56 flex-1"
  />

  <Select
    label="Status"
    name="status"
    options={statusOptions}
    value={status}
    class="min-w-40 flex-1 sm:flex-none"
    onchange={(event) => event.currentTarget.form?.requestSubmit()}
  />

  <Select
    label="Role"
    name="role"
    options={roleOptions}
    value={role}
    class="min-w-36 flex-1 sm:flex-none"
    onchange={(event) => event.currentTarget.form?.requestSubmit()}
  />

  <Button type="submit" variant="secondary">
    <Search size={16} aria-hidden="true" />
    Search
  </Button>
</form>
