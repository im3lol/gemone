<!--
  One held conversion, and the decision on it — PROJECT.md §4.7.

  A card rather than a table row, because a decision needs its evidence beside
  it: the score, which rules produced it, what the engine was told to do, how
  long the account has been waiting, and how many points are being withheld.
  A table would put all of that behind a link, and a queue whose every entry
  costs a page load is a queue that does not get emptied.

  ## Everything shown here comes off the summary

  `AdminHeldConversionSummary` carries the score, the rules that fired, the
  reward, the review reason and the two timestamps. Nothing on this card is
  fetched per row — the full evaluation, with each rule's threshold at the time,
  lives behind `GET /admin/fraud/evaluations/:id`, and the summary does not
  carry that id, so there is nothing to link to yet. Recorded rather than
  invented: the queue works without it.

  ## What is deliberately not shown

  No email, no IP address, no device fingerprint. The rules that fired *name*
  those signals — "Accounts sharing this IP address" — and the operator is
  deciding whether the engine was right, which the count answers and the raw
  value does not. Putting a user's IP in a queue response is a decision that
  should be made deliberately if it is ever needed, not as a side effect of
  laying out a card.

  ## Duplicate decisions

  Three layers, and only the last is real. The submitting form disables both
  buttons; a resolved hold is gone from the queue on the next load; and
  `resolveHold` re-reads the row `FOR UPDATE` inside the transaction that moves
  the points, so the second of two admins gets a 409 saying the conversion is
  no longer held. That last one is the guard.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { AdminHeldConversionSummary } from '@gemone/contracts';

  import { Alert, Badge, Button, Card, Input } from '$lib/components/ui';
  import { FRAUD_DECISIONS, ruleLabel, shortId, waitingLabel } from '$lib/admin/fraud';
  import { absoluteDate, formatPoints, relativeTime } from '$lib/rewards/ledger';

  import type { FraudActionResult } from './types';

  type Props = {
    held: AdminHeldConversionSummary;
    /** One timestamp for every relative time, so SSR and hydration agree. */
    now: string;
    /** The result of the last decision, when it was about this conversion. */
    result: FraudActionResult | null;
  };

  let { held, now, result }: Props = $props();

  const waiting = $derived(waitingLabel(held.createdAt, now));
  const occurred = $derived(held.occurredAt ?? held.createdAt);

  /** Which decision is in flight, or `null`. Disables both forms, not just its own. */
  let submitting = $state<string | null>(null);
</script>

<Card as="article" padding="lg" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 class="gm-card-title">
        {formatPoints(held.rewardPoints)} points held
      </h3>
      <p class="gm-subtitle mt-1">
        Account <span class="font-mono" title={held.userId}>{shortId(held.userId)}</span>
        · converted
        <time datetime={occurred} title={absoluteDate(occurred)}>{relativeTime(occurred, now)}</time>
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Badge variant={waiting.tone}>{waiting.text}</Badge>
      <!--
        The score as the number it is. There is no band here on purpose: the
        threshold that made it meaningful is snapshotted per rule on the
        evaluation, and a "high risk" label invented on this card would be a
        fraud rule no configuration could change.
      -->
      {#if held.fraudScore !== null}
        <Badge variant="neutral">Score {held.fraudScore}</Badge>
      {:else}
        <!--
          Not scored is not the same as scored clean. §10.3 step 3 holds an
          inactive account before any rule runs, and a scoring failure leaves
          the conversion unscored deliberately.
        -->
        <Badge variant="warning">Not scored</Badge>
      {/if}
    </div>
  </div>

  {#if held.reviewReason}
    <p class="gm-caption">
      <span class="font-medium text-text">Held because:</span>
      {held.reviewReason}
    </p>
  {/if}

  {#if held.triggeredRules.length > 0}
    <div>
      <h4 class="gm-caption font-medium text-text">What fired</h4>
      <ul class="mt-2 flex flex-col gap-1">
        {#each held.triggeredRules as rule (rule)}
          <li class="gm-caption flex items-start gap-2">
            <span aria-hidden="true">•</span>
            <span>{ruleLabel(rule)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="gm-caption">
      No rule fired. This conversion was held before scoring ran.
    </p>
  {/if}

  {#if result?.ok === false}
    <!--
      The API's own message. Every reason a hold can refuse to resolve lives in
      `resolveHold`; restating one here would be a second copy of a rule that
      lives somewhere else, and the copy without tests over real data.
    -->
    <Alert variant="error" title="That could not be recorded">{result.message}</Alert>
  {/if}

  <div class="flex flex-col gap-3 border-t border-border pt-4">
    {#each FRAUD_DECISIONS as decision (decision.action)}
      <form
        method="POST"
        action="?/{decision.action}"
        class="flex flex-col gap-2 sm:flex-row sm:items-end"
        use:enhance={({ cancel }) => {
          if (submitting) return cancel();
          submitting = decision.action;

          return async ({ update }) => {
            submitting = null;
            // The default: apply the result and re-run the load, which is what
            // takes a resolved hold out of the queue.
            await update();
          };
        }}
      >
        <input type="hidden" name="conversionId" value={held.conversionId} />

        <!--
          Required, and required by the API too — `ReviewHeldConversionDto`
          makes it mandatory, unlike a payout approval's. Both outcomes here are
          the kind of decision that gets questioned weeks later, and one
          resolved without a stated reason is one nobody can audit.
        -->
        <Input
          label={decision.label}
          name="reason"
          hint={decision.hint}
          placeholder="Why?"
          required
          maxlength={500}
          autocomplete="off"
          class="flex-1"
        />

        <Button
          type="submit"
          variant={decision.variant}
          loading={submitting === decision.action}
          disabled={submitting !== null}
        >
          {submitting === decision.action ? 'Recording…' : decision.label}
        </Button>
      </form>
    {/each}
  </div>
</Card>
