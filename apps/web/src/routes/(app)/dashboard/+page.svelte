<!--
  The dashboard — DESIGN_SYSTEM.md §16, §15.2.

  Legacy's composition order is: greeting, the stat row, then a two-column
  split at `xl` with the wide column on the left and a 320px rail on the right.
  This keeps that skeleton and fills it with what exists:

  ```
  Welcome back, {name}                        + Browse offers · Withdraw
  Available · Pending · Locked · Total earned
  ┌──────────────────────────┬──────────────┐
  │ Recent activity          │ Earnings     │
  │                          │ overview     │
  │                          │ Your account │
  └──────────────────────────┴──────────────┘
  ```

  Legacy's daily-bonus strip, recommended-offers rail, achievements grid,
  referral card and level card are **not** here. None of them has anything
  behind it — no bonus schedule, no recommendation, no achievements, no
  referrals, no levels — and a dashboard whose most prominent element is a
  button that claims a bonus that does not exist is the defect UI_AUDIT.md §9
  records against legacy, put on the first screen after login.

  ## The greeting

  Legacy greets a display name. The API has no name on an account, so the local
  part of the email is used — the same thing the topbar's identity pill does
  (DS §14.3), so the two agree on what to call you.
-->
<script lang="ts">
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';

  import {
    AccountCard,
    BalanceGrid,
    EarningsOverview,
    RecentActivity,
  } from '$lib/components/dashboard';
  import { Button, PageHeader } from '$lib/components/ui';

  let { data } = $props();

  const name = $derived(data.profile.email.split('@')[0]);
</script>

<svelte:head><title>Dashboard · GemOne</title></svelte:head>

<div class="flex flex-col gap-5">
  <!--
    The two quick actions, and only the two. Both go to routes that exist and
    work today; a third for a feature that does not is a button that teaches
    people the buttons here are decorative.
  -->
  <PageHeader
    title="Welcome back, {name}"
    description="Here is where your points stand today."
  >
    {#snippet actions()}
      <Button href="/offers">
        <LayoutGrid size={16} aria-hidden="true" />
        Browse offers
      </Button>
      <Button href="/payouts" variant="secondary">
        <ArrowDownToLine size={16} aria-hidden="true" />
        Withdraw
      </Button>
    {/snippet}
  </PageHeader>

  <BalanceGrid balance={data.balance} rate={data.payoutOptions} />

  <!--
    `xl:grid-cols-[1fr_320px]` is legacy's split (DS §15.5). Below `xl` it is
    one column and the rail falls underneath the activity list, which is the
    right order on a phone: what happened to my points, then the summary of
    them.
  -->
  <div class="grid gap-5 xl:grid-cols-[1fr_320px]">
    <RecentActivity activity={data.activity} now={data.now} />

    <div class="flex flex-col gap-5">
      <EarningsOverview balance={data.balance} />
      <AccountCard profile={data.profile} />
    </div>
  </div>
</div>
