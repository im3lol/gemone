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

  ## What is not here

  Legacy's cards carry a `≈ $12.56 USD` sub-line under every points figure. The
  API exposes no points-to-currency rate to a user — the withdrawal minimum and
  the conversion are the payout service's business and never reach `/rewards/*`
  — so there is nothing to compute it from. An invented rate on a balance
  screen is a number someone would plan around. Recorded as TODO T78.

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
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = { balance: Balance | null };

  let { balance }: Props = $props();

  const show = (points: number | undefined) =>
    points === undefined ? '—' : formatPoints(points);
</script>

<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
  <StatCard
    label="Available"
    value={show(balance?.available)}
    unit="points"
    tone="brand"
    icon={Wallet}
    trend={{ label: 'Ready to withdraw', direction: 'flat', sentiment: 'positive' }}
  />

  <StatCard
    label="Pending"
    value={show(balance?.pending)}
    unit="points"
    tone="amber"
    icon={Clock}
    trend={{ label: 'Inside the hold period', direction: 'flat' }}
  />

  <StatCard
    label="Locked"
    value={show(balance?.locked)}
    unit="points"
    tone="blue"
    icon={Lock}
    trend={{ label: 'Reserved by a withdrawal', direction: 'flat' }}
  />

  <StatCard
    label="Total earned"
    value={show(balance?.lifetimeEarned)}
    unit="points, all time"
    tone="purple"
    icon={TrendingUp}
    trend={{ label: 'Since you joined', direction: 'flat' }}
  />
</div>
