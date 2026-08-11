<!--
  What an admin decides on — ARCHITECTURE.md §11.3.

  *"The admin sees the account's fraud score, conversion history, chargeback
  rate, account age, and any shared-device or shared-IP signals alongside the
  request."* All of it arrives on `AdminPayoutDetail.reviewContext`; this
  renders it and computes nothing.

  ## The two figures that are read together

  A **balance** and a **chargeback count**. An `available` balance that is
  exactly this request reads differently from one far larger, and a `locked`
  total bigger than this request means something else is also in flight. They
  are shown as three buckets for that reason and never summed.

  ## Fraud is `null`, not zero, when nothing was scored

  And the difference is the whole point: `peakScore: 0` reads as "the engine
  looked and found nothing clean", which is the opposite of "never looked".
  The contract makes it nullable deliberately and this says so in words.
-->
<script lang="ts">
  import type { PayoutReviewContext } from '@gemone/contracts';

  import { Badge, Card } from '$lib/components/ui';
  import { formatPoints, absoluteDate } from '$lib/rewards/ledger';

  type Props = { context: PayoutReviewContext };

  let { context }: Props = $props();

  /*
   * Tones for the two counts that carry a judgement. Nothing here decides
   * anything — a chargeback is a fact, and the colour only saves an admin from
   * reading a zero and a seven with the same weight.
   */
  const chargebackTone = $derived(context.chargebackCount > 0 ? 'warning' : 'neutral');
  const statusTone = $derived(context.accountStatus === 'ACTIVE' ? 'success' : 'error');
</script>

<Card as="section" padding="lg" class="flex flex-col gap-4" aria-labelledby="account-title">
  <div>
    <h2 id="account-title" class="gm-card-title">The account</h2>
    <p class="gm-subtitle mt-1">What this request is being judged on.</p>
  </div>

  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
    <div>
      <dt class="gm-caption">Member since</dt>
      <dd class="font-medium text-text">{absoluteDate(context.accountCreatedAt)}</dd>
    </div>

    <div>
      <dt class="gm-caption">Account status</dt>
      <dd><Badge variant={statusTone}>{context.accountStatus}</Badge></dd>
    </div>

    <div>
      <dt class="gm-caption">Paid before</dt>
      <dd class="font-medium text-text">{context.paidPayoutCount}</dd>
    </div>

    <div>
      <dt class="gm-caption">Conversions</dt>
      <dd class="font-medium text-text">{context.conversionCount}</dd>
    </div>

    <div>
      <dt class="gm-caption">Chargebacks</dt>
      <dd><Badge variant={chargebackTone}>{context.chargebackCount}</Badge></dd>
    </div>
  </dl>

  <div class="border-t border-border pt-4">
    <p class="gm-caption">Balance</p>
    <dl class="mt-1 flex flex-wrap gap-x-6 gap-y-1">
      <div class="flex gap-2">
        <dt class="text-text-secondary">Available</dt>
        <dd class="font-medium text-text">{formatPoints(context.balance.available)}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-text-secondary">Pending</dt>
        <dd class="font-medium text-text">{formatPoints(context.balance.pending)}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-text-secondary">Reserved</dt>
        <dd class="font-medium text-text">{formatPoints(context.balance.locked)}</dd>
      </div>
    </dl>
  </div>

  <div class="border-t border-border pt-4">
    <p class="gm-caption">Fraud signals</p>

    {#if !context.fraud}
      <p class="gm-subtitle mt-1">
        This account has never been scored — a new account, or one whose conversions all
        predate the engine. That is not the same as having been checked and found clean.
      </p>
    {:else}
      <dl class="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <div class="flex gap-2">
          <dt class="text-text-secondary">Latest score</dt>
          <dd class="font-medium text-text">{context.fraud.latestScore ?? '—'}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="text-text-secondary">Peak</dt>
          <dd class="font-medium text-text">{context.fraud.peakScore ?? '—'}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="text-text-secondary">Flagged</dt>
          <dd class="font-medium text-text">{context.fraud.flaggedCount}</dd>
        </div>
      </dl>

      {#if context.fraud.rulesEverTriggered.length > 0}
        <!--
          The shared-device and shared-IP signals §11.3 asks for are these:
          the rules that fired are what those signals *are*.
        -->
        <p class="mt-2 flex flex-wrap gap-1">
          {#each context.fraud.rulesEverTriggered as rule (rule)}
            <Badge variant="warning">{rule.replaceAll('_', ' ').toLowerCase()}</Badge>
          {/each}
        </p>
      {/if}
    {/if}
  </div>
</Card>
