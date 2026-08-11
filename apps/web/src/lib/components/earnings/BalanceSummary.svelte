<!--
  The three figures this page is about — DESIGN_SYSTEM.md §11.3.

  **The tinted variant, not the dashboard's.** Legacy uses two stat-card
  treatments: an icon on a tinted circle for the dashboard (§11.2), and a
  whole-card tint with no icon for the wallet (§11.3). This is the wallet
  screen, so it gets the wallet card — which also stops the page opening with
  a row that looks like the one two clicks away.

  Three, not the dashboard's four: available, pending, and lifetime earnings.
  `locked` belongs to the withdrawal it is reserved by, and that screen is
  `/payouts`.

  `—` rather than `0` when the balance could not be loaded, for the reason the
  topbar hides its pill: a zero balance and an unknown balance are different
  claims about somebody's money.
-->
<script lang="ts">
  import type { Balance } from '@gemone/contracts';

  import { StatCard } from '$lib/components/ui';
  import { formatPoints } from '$lib/rewards/ledger';

  type Props = { balance: Balance | null };

  let { balance }: Props = $props();

  const show = (points: number | undefined) => (points === undefined ? '—' : formatPoints(points));
</script>

<div class="grid gap-4 sm:grid-cols-3">
  <StatCard filled tone="brand" label="Available" value={show(balance?.available)} unit="points" />
  <StatCard filled tone="amber" label="Pending" value={show(balance?.pending)} unit="points" />
  <StatCard
    filled
    tone="purple"
    label="Total earned"
    value={show(balance?.lifetimeEarned)}
    unit="points, all time"
  />
</div>
