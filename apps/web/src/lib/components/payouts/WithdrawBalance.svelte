<!--
  The three buckets, from the withdrawal screen's point of view — DS §11.3.

  `/earnings` shows Available, Pending and *lifetime earnings*, because that
  page answers "where did this number come from". This one answers "what can I
  take out right now", so the third card is **Reserved** — the points already
  claimed by a request in the queue.

  That is the bucket `/earnings` deliberately leaves out, and this is the screen
  it belongs to: locked points are invisible everywhere else, and a user whose
  available balance dropped after submitting a withdrawal has no other place to
  see where they went.

  The cash line under Available is the resolution of TODO T78 — a real rate
  from `GET /payouts/options`, not a number invented for the sake of having one.
  When the options call failed there is no rate, and the line is simply absent.
-->
<script lang="ts">
  import type { Balance, PayoutOptions } from '@gemone/contracts';

  import { StatCard } from '$lib/components/ui';
  import { approxCash } from '$lib/payouts/payout';
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = {
    balance: Balance | null;
    options: PayoutOptions | null;
  };

  let { balance, options }: Props = $props();

  /*
   * `—` rather than `0` when the balance could not be loaded, for the reason
   * the topbar hides its pill: a zero balance and an unknown balance are
   * different claims about somebody's money.
   */
  const show = (points: number | undefined) => (points === undefined ? '—' : formatPoints(points));

  const availableCash = $derived(
    balance && options ? approxCash(balance.available, options.pointsPerCurrencyUnit, options.currency) : undefined,
  );
</script>

<div class="grid gap-4 sm:grid-cols-3">
  <StatCard
    filled
    tone="brand"
    label="Available to withdraw"
    value={show(balance?.available)}
    unit={availableCash ? `points · ${availableCash} ${options?.currency}` : 'points'}
  />
  <StatCard
    filled
    tone="amber"
    label="Still clearing"
    value={show(balance?.pending)}
    unit="points, inside the hold period"
  />
  <StatCard
    filled
    tone="purple"
    label="Reserved"
    value={show(balance?.locked)}
    unit="points held by a request"
  />
</div>
