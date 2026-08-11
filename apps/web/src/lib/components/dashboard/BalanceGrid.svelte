<!--
  The balance row — DESIGN_SYSTEM.md §11.2, §15.5, §16.

  Four `StatCard`s in legacy's wallet grid (`sm:grid-cols-2 xl:grid-cols-4`),
  each one bucket of the balance. **Three buckets, never one number**
  (ARCHITECTURE.md §9.2): a single "your balance" figure tells someone they can
  withdraw points that are still inside their hold period, which is the single
  most common way an offerwall creates a support ticket.

  The fourth card is lifetime earnings, which is the only figure here that is
  not a bucket — it answers "has this been worth it", which is a different
  question from "what can I spend".

  ## The cash sub-line

  Legacy's cards carry `≈ $12.56 USD` under every points figure, and for four
  phases this had none: no user-facing endpoint exposed a rate (TODO T78). It
  does now — `payouts.points_per_currency_unit`, read once by
  `(app)/+layout.server.ts` for the whole group (T83) — so every bucket quotes
  the same number from the same source the payout service enforces.

  Points stay the value. The cash is a caption under it, marked `≈`, because
  the number a user earns and spends is points and the equivalent is context.

  ## The unknown balance

  `balance` is null when `/rewards/balance` failed. The cards then show `—`
  rather than `0`, because a zero balance and an unfetchable balance are
  different claims, and the one that reads as "you have nothing" is the wrong
  guess to make about someone's money.
-->
<script lang="ts">
  import Clock from '@lucide/svelte/icons/clock';
  import Lock from '@lucide/svelte/icons/lock';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import Wallet from '@lucide/svelte/icons/wallet';
  import type { Balance } from '@gemone/contracts';

  import { StatCard } from '$lib/components/ui';
  import { pointsUnit, type PointsRate } from '$lib/payouts/payout';
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = {
    balance: Balance | null;
    /** The configured rate, or null when the options call failed. */
    rate: PointsRate;
  };

  let { balance, rate }: Props = $props();

  const show = (points: number | undefined) =>
    points === undefined ? '—' : formatPoints(points);
</script>

<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
  <StatCard
    label="Available"
    value={show(balance?.available)}
    unit={pointsUnit(balance?.available, rate)}
    tone="brand"
    icon={Wallet}
    trend={{ label: 'Ready to withdraw', direction: 'flat', sentiment: 'positive' }}
  />

  <StatCard
    label="Pending"
    value={show(balance?.pending)}
    unit={pointsUnit(balance?.pending, rate)}
    tone="amber"
    icon={Clock}
    trend={{ label: 'Inside the hold period', direction: 'flat' }}
  />

  <StatCard
    label="Locked"
    value={show(balance?.locked)}
    unit={pointsUnit(balance?.locked, rate)}
    tone="blue"
    icon={Lock}
    trend={{ label: 'Reserved by a withdrawal', direction: 'flat' }}
  />

  <StatCard
    label="Total earned"
    value={show(balance?.lifetimeEarned)}
    unit={pointsUnit(balance?.lifetimeEarned, rate, { suffix: ', all time' })}
    tone="purple"
    icon={TrendingUp}
    trend={{ label: 'Since you joined', direction: 'flat' }}
  />
</div>
