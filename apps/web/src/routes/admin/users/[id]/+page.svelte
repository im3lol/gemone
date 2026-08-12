<!--
  One account — ARCHITECTURE.md §8.4.

  ```
  ← Users
  someone@example.com                          Active · User
  ┌──────────────────────────────────────────────────────────┐
  │ Balance · available / pending / reserved                 │
  ├──────────────────────────┬───────────────────────────────┤
  │ Standing                 │ Fraud signals                 │
  │ suspend / ban / close    │ Withdrawals · Conversions     │
  │ end sessions             │ Administrative history        │
  └──────────────────────────┴───────────────────────────────┘
  ```

  The decisions on the left, the evidence on the right, and at `xl` they sit
  side by side so an operator does not have to remember one while scrolling to
  the other.

  The balance spans both columns above them (T84). It belongs to neither: it is
  not a decision, and it is not one panel of activity among four — it is the
  fact an operator is most often on this page to read, and every decision below
  is taken with it in view.

  `data.admin` comes from `admin/+layout.server.ts`, which already loaded the
  signed-in administrator to decide whether to render these screens at all. The
  self-action check reads it rather than asking `/users/me` a second time —
  T74's lesson, applied before the duplicate exists.
-->
<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  import { UserAccountActivity, UserActions, UserBalance } from '$lib/components/admin';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import { isSelf, roleLabel, userState } from '$lib/admin/users';
  import { absoluteDate } from '$lib/rewards/ledger';

  let { data, form } = $props();

  const account = $derived(data.account);
  const state = $derived(userState(account.status));
  const self = $derived(isSelf(account.id, data.admin?.id));
</script>

<svelte:head><title>{account.email} · GemOne admin</title></svelte:head>

<div class="flex flex-col gap-5">
  <div>
    <Button href="/admin/users" variant="ghost" size="sm">
      <ArrowLeft size={16} aria-hidden="true" />
      Users
    </Button>
  </div>

  <PageHeader title={account.email}>
    {#snippet actions()}
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={state.tone}>{state.label}</Badge>
        <Badge variant={account.role === 'ADMIN' ? 'brand' : 'neutral'}>
          {roleLabel(account.role)}
        </Badge>
      </div>
    {/snippet}
  </PageHeader>

  <!--
    The facts from the summary itself, above both columns: they are what an
    operator reads before deciding which column to use.
  -->
  <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div>
      <dt class="gm-caption">Registered</dt>
      <dd class="font-medium text-text">
        <time datetime={account.createdAt}>{absoluteDate(account.createdAt)}</time>
      </dd>
    </div>
    <div>
      <dt class="gm-caption">Email verified</dt>
      <dd class="font-medium text-text">
        {#if account.emailVerifiedAt}
          <time datetime={account.emailVerifiedAt}>{absoluteDate(account.emailVerifiedAt)}</time>
        {:else}
          Not verified
        {/if}
      </dd>
    </div>
    <div>
      <dt class="gm-caption">Active sessions</dt>
      <dd class="font-medium text-text">{account.activeSessionCount}</dd>
    </div>
    <div>
      <dt class="gm-caption">Registered from</dt>
      <!--
        The country, which is on the summary. The registration IP is not, and
        deliberately: `toAdminSummary` is an allowlist and "admin" is not a
        reason to serialise it.
      -->
      <dd class="font-medium text-text">{account.registrationCountry ?? 'Unknown'}</dd>
    </div>
  </dl>

  <UserBalance balance={data.balance} />

  <div class="grid gap-5 xl:grid-cols-2">
    <div class="min-w-0">
      <UserActions {account} {self} result={form ?? null} />
    </div>

    <div class="min-w-0">
      <UserAccountActivity {account} activity={data.activity} now={data.now} />
    </div>
  </div>
</div>
