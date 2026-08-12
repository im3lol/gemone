<!--
  What this account has done, and what has been done to it.

  Four panels, four existing admin endpoints, each asked with the `userId`
  filter it already had. Nothing was added to the API for this screen — `admin`
  is a composition layer (ARCHITECTURE.md §4.3), and so is this.

  ## Each panel fails on its own

  Every field is nullable, and a null is that endpoint having a bad minute. The
  panel says so and the rest of the page carries on: none of these is what an
  administrator came here to change, and a fraud-signals call failing should
  not stop them suspending an account.

  ## Totals, not tables

  Five rows of each is enough to see a pattern; the dedicated screens hold the
  rest and are linked to. A full payout history rendered here would be a second
  copy of `/admin/payouts` that nobody maintains.

  ## No balance

  There is no admin endpoint for an arbitrary user's three buckets, and a total
  summed from the conversions below is not a balance — it ignores maturation,
  chargebacks and locks. Absent rather than approximated (TODO T84).
-->
<script lang="ts">
  import type { AdminUserSummary } from '@gemone/contracts';

  import { Badge, Button, Card } from '$lib/components/ui';
  import { ruleLabel } from '$lib/admin/fraud';
  import { queueState } from '$lib/admin/payout-queue';
  import { formatPoints, absoluteDate, relativeTime } from '$lib/rewards/ledger';

  import type { AccountActivity } from './types';

  type Props = {
    account: AdminUserSummary;
    activity: AccountActivity;
    now: string;
  };

  let { account, activity, now }: Props = $props();

  const { payouts, conversions, signals, auditLog } = $derived(activity);
</script>

<div class="flex flex-col gap-5">
  <!-- Fraud signals: the same numbers the payout review screen shows (§11.3). -->
  <Card as="section" padding="lg" aria-labelledby="signals-title">
    <h2 id="signals-title" class="gm-card-title">Fraud signals</h2>

    {#if !signals}
      <p class="gm-caption mt-2">These could not be loaded. Nothing about the account has changed.</p>
    {:else}
      <dl class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt class="gm-caption">Peak score</dt>
          <dd class="font-bold text-text">{signals.peakScore}</dd>
        </div>
        <div>
          <dt class="gm-caption">Latest score</dt>
          <!--
            Null is not zero. An account that has never been scored is not an
            account that scored clean — §10.3 holds some conversions before any
            rule runs.
          -->
          <dd class="font-bold text-text">{signals.latestScore ?? 'Never scored'}</dd>
        </div>
        <div>
          <dt class="gm-caption">Flagged</dt>
          <dd class="font-bold text-text">{signals.flaggedCount}</dd>
        </div>
        <div>
          <dt class="gm-caption">Rules fired</dt>
          <dd class="font-bold text-text">{signals.rulesEverTriggered.length}</dd>
        </div>
      </dl>

      {#if signals.rulesEverTriggered.length > 0}
        <ul class="mt-3 flex flex-wrap gap-2">
          {#each signals.rulesEverTriggered as rule (rule)}
            <li><Badge variant="warning">{ruleLabel(rule)}</Badge></li>
          {/each}
        </ul>
      {/if}

      <div class="mt-4">
        <Button href="/admin/fraud?userId={account.id}" variant="secondary" size="sm">
          Held conversions for this account
        </Button>
      </div>
    {/if}
  </Card>

  <!-- Withdrawals. -->
  <Card as="section" padding="lg" aria-labelledby="payouts-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h2 id="payouts-title" class="gm-card-title">
        Withdrawals {#if payouts}<span class="gm-caption font-normal">· {payouts.total}</span>{/if}
      </h2>
      <Button href="/admin/payouts?status=&userId={account.id}" variant="secondary" size="sm">
        All withdrawals
      </Button>
    </div>

    {#if !payouts}
      <p class="gm-caption mt-2">These could not be loaded.</p>
    {:else if payouts.items.length === 0}
      <p class="gm-caption mt-2">This account has never requested a withdrawal.</p>
    {:else}
      <ul class="mt-4 flex flex-col gap-3">
        {#each payouts.items as payout (payout.id)}
          {@const state = queueState(payout.status)}
          <li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div class="min-w-0">
              <p class="font-medium text-text">{formatPoints(payout.amountPoints)} points</p>
              <p class="gm-caption">
                <time datetime={payout.createdAt} title={absoluteDate(payout.createdAt)}>
                  {relativeTime(payout.createdAt, now)}
                </time>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant={state.tone}>{state.label}</Badge>
              <Button href="/admin/payouts/{payout.id}" variant="ghost" size="sm">Open</Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <!-- Conversions. -->
  <Card as="section" padding="lg" aria-labelledby="conversions-title">
    <h2 id="conversions-title" class="gm-card-title">
      Conversions {#if conversions}<span class="gm-caption font-normal">· {conversions.total}</span>{/if}
    </h2>

    {#if !conversions}
      <p class="gm-caption mt-2">These could not be loaded.</p>
    {:else if conversions.items.length === 0}
      <p class="gm-caption mt-2">This account has never converted an offer.</p>
    {:else}
      <ul class="mt-4 flex flex-col gap-3">
        {#each conversions.items as conversion (conversion.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div class="min-w-0">
              <p class="font-medium text-text">{formatPoints(conversion.rewardPoints)} points</p>
              <p class="gm-caption">
                {conversion.providerSlug} ·
                <time datetime={conversion.createdAt} title={absoluteDate(conversion.createdAt)}>
                  {relativeTime(conversion.createdAt, now)}
                </time>
              </p>
            </div>
            <!--
              The status verbatim from the contract. There is no vocabulary
              module for conversion statuses and inventing one here would put
              the words in the wrong place — `/admin/fraud` is the screen that
              acts on them.
            -->
            <Badge variant={conversion.status === 'HELD' ? 'warning' : 'neutral'}>
              {conversion.status}
            </Badge>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <!-- What administrators have done to this account. -->
  <Card as="section" padding="lg" aria-labelledby="audit-title">
    <h2 id="audit-title" class="gm-card-title">
      Administrative history {#if auditLog}<span class="gm-caption font-normal">· {auditLog.total}</span>{/if}
    </h2>
    <p class="gm-subtitle mt-1">
      Recorded actions on this account. These rows are never removed.
    </p>

    {#if !auditLog}
      <p class="gm-caption mt-2">This could not be loaded.</p>
    {:else if auditLog.items.length === 0}
      <p class="gm-caption mt-2">No administrator has acted on this account.</p>
    {:else}
      <ul class="mt-4 flex flex-col gap-3">
        {#each auditLog.items as entry (entry.id)}
          <li class="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p class="font-medium text-text">{entry.action}</p>
            {#if entry.reason}
              <p class="gm-caption">{entry.reason}</p>
            {/if}
            <p class="gm-caption">
              <time datetime={entry.createdAt} title={absoluteDate(entry.createdAt)}>
                {relativeTime(entry.createdAt, now)}
              </time>
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>
