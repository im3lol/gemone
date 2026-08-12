<!--
  What this account holds — TODO T84, ARCHITECTURE.md §9.2.

  ```
  ┌────────────────────────────────────────────────┐
  │ Balance            from the reward ledger      │
  │  Available   Pending    Reserved               │
  │   12,400      3,000      5,000                 │
  │  Earned 20,400 · Withdrawn 0 · Reversed 0      │
  └────────────────────────────────────────────────┘
  ```

  ## Three buckets, never one number

  The three answer three different support questions, and only `available` is
  the one a withdrawal may be checked against. `total` is on the contract so
  nobody adds the three up wrongly — not so that it can be shown as a fourth
  figure beside them, which is exactly how an operator ends up confirming a
  withdrawal against points still inside a hold period.

  ## Stated to be the ledger's own answer

  The subtitle says where these come from, because the question this screen
  invites is *"is this the same number the user sees?"* — and the answer is
  that it is literally the same call. `GET /admin/users/:id/balance` returns
  `RewardAccountingService.getBalance`, the figures the accounting service
  holds, not a total of the conversions listed further down this page. That
  sum would ignore maturation, chargebacks and locks; a number on an admin
  screen that disagrees with the ledger is worse than no number at all.

  ## `—`, not `0`

  When the call failed there is no balance to show, and a zero would be read as
  evidence about the account. The same rule the user's own wallet follows.
-->
<script lang="ts">
  import type { Balance } from '@gemone/contracts';

  import { balanceBuckets, lifetimeFigures } from '$lib/admin/users';
  import { Card } from '$lib/components/ui';
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = {
    /** Null when `GET /admin/users/:id/balance` failed — never a zeroed stand-in. */
    balance: Balance | null;
  };

  let { balance }: Props = $props();

  const buckets = $derived(balanceBuckets(balance));
  const lifetime = $derived(lifetimeFigures(balance));

  const show = (points: number | undefined) => (points === undefined ? '—' : formatPoints(points));

  /* The whole-card tints legacy uses for the wallet (DESIGN_SYSTEM.md §11.3). */
  const tints = {
    brand: 'bg-brand-50',
    amber: 'bg-warning-soft',
    blue: 'bg-info-soft',
  };
</script>

<Card as="section" padding="lg" aria-labelledby="balance-title">
  <h2 id="balance-title" class="gm-card-title">Balance</h2>
  <p class="gm-subtitle mt-1">
    The accounting balance, read from the reward ledger — the same three figures the account
    holder sees. Not a total of the conversions below.
  </p>

  {#if !balance}
    <p class="gm-caption mt-3" role="status">
      This could not be loaded. Nothing about the account has changed, and the figures below are
      unknown rather than zero.
    </p>
  {/if}

  <dl class="mt-4 grid gap-3 sm:grid-cols-3">
    {#each buckets as bucket (bucket.key)}
      <div class="min-w-0 rounded-lg p-3 {tints[bucket.tone]}">
        <dt class="gm-caption">{bucket.label}</dt>
        <dd class="mt-1 text-xl font-bold break-words text-text">{show(bucket.points)}</dd>
        <p class="gm-caption mt-1">{bucket.hint}</p>
      </div>
    {/each}
  </dl>

  <!--
    Lifetime figures, kept visually apart from the buckets: they describe what
    has passed through the account rather than what is in it, and a fourth card
    in the row above would read as a fourth bucket.
  -->
  <dl class="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-4">
    {#each lifetime as figure (figure.key)}
      <div class="flex gap-2">
        <dt class="text-text-secondary">{figure.label}</dt>
        <dd class="font-medium text-text">{show(figure.points)}</dd>
      </div>
    {/each}
  </dl>
</Card>
