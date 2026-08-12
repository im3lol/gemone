<!--
  Accounts — ARCHITECTURE.md §8.4.

  The screen an operator opens when a support ticket arrives with an email
  address on it. Deliberately not an analytics page: no registration chart, no
  cohort, no activity graph. Find the account, read its standing, change it.
-->
<script lang="ts">
  import { UserList } from '$lib/components/admin';
  import { PageHeader } from '$lib/components/ui';

  let { data } = $props();
</script>

<svelte:head><title>Accounts · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <PageHeader
    title="Users"
    description="Every account on the platform, and the standing each one holds."
  />

  <UserList
    users={data.users}
    now={data.now}
    status={data.status}
    role={data.role}
    email={data.email}
    offset={data.offset}
    pageSize={data.pageSize}
    query={data.query}
  />
</div>
