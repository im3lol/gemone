<!--
  The withdrawal form — DESIGN_SYSTEM.md §9.1, §10.

  ```
  ┌─────────────────────────────────────────┐
  │ Request a withdrawal                    │
  │ [ success / failure alert ]             │
  │ Method     [ PayPal            ▾ ]      │
  │ Points     [ 5000              ]  ≈$5.00│
  │ Where      [ you@example.com   ]        │
  │ [        Request withdrawal        ]    │
  └─────────────────────────────────────────┘
  ```

  ## The panel has three shapes, not one

  A form that cannot succeed is a trap, so it is not rendered when it cannot:

  - **No options.** `GET /payouts/options` failed, so the methods, the minimum
    and the rate are all unknown. A form built on guesses at those would be
    inventing the rules — the one thing this phase must not do.
  - **Below the minimum.** The configured floor, from the API, next to what the
    person actually has. Showing a submit button that the server is certain to
    refuse teaches people the product is broken.
  - **Otherwise**, the form.

  ## What it does not decide

  Nothing. Every limit rendered here — the minimum, the maximum, the methods,
  the rate — arrives from configuration through the API, and the submission is
  validated there again. The `min`/`max` attributes are a courtesy that saves a
  round trip; they are not the rule, and the page works with them ignored.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
  import Wallet from '@lucide/svelte/icons/wallet';
  import type { Balance, PayoutOptions } from '@gemone/contracts';

  import { Alert, Button, Card, EmptyState, ErrorState, Input, Select } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { approxCash, formatCash, methodName, payoutReference } from '$lib/payouts/payout';
  import { formatPoints } from '$lib/rewards/ledger';

  import type { WithdrawResult } from './types';

  type Props = {
    options: PayoutOptions | null;
    balance: Balance | null;
    result: WithdrawResult | null;
  };

  let { options, balance, result }: Props = $props();

  const failure = $derived(result && !result.ok ? result : null);
  const success = $derived(result?.ok ? result.payout : null);

  /*
   * Seeded from what the server echoed back, so the no-JS path returns a
   * filled form. On the enhanced path `result` starts null and these are the
   * defaults — a single enabled method is pre-selected, because making someone
   * choose from a list of one is a question with no information in it.
   *
   * `untrack` because the *initial* value is the whole intent: once someone is
   * typing, a later action result must not reach in and overwrite what is in
   * the box. That is the same requirement as "do not lose the user's entered
   * information", stated as a subscription rather than a copy.
   */
  let method = $state(untrack(() => failure?.values.method || options?.methods[0] || ''));
  let amount = $state<number | null>(untrack(() => Number(failure?.values.amountPoints) || null));
  let destination = $state(untrack(() => failure?.values.destination ?? ''));

  let submitting = $state(false);

  const methodOptions = $derived<SelectOption[]>(
    (options?.methods ?? []).map((slug) => ({ value: slug, label: methodName(slug) })),
  );

  /**
   * The largest amount that could possibly succeed.
   *
   * The configured ceiling and the balance, whichever binds first — asking for
   * more than either is refused, and the field may as well say so. When the
   * balance could not be loaded the configured maximum stands alone rather
   * than a guess at what is available.
   */
  const effectiveMax = $derived(
    options
      ? balance
        ? Math.min(options.maximumPoints, balance.available)
        : options.maximumPoints
      : 0,
  );

  const belowMinimum = $derived(
    Boolean(options && balance && balance.available < options.minimumPoints),
  );

  const preview = $derived(
    options && amount && amount > 0
      ? `${approxCash(amount, options.pointsPerCurrencyUnit, options.currency)} ${options.currency}`
      : undefined,
  );
</script>

<Card as="section" padding="lg" aria-labelledby="withdraw-title">
  <h2 id="withdraw-title" class="gm-card-title">Request a withdrawal</h2>
  <p class="gm-subtitle mt-1">
    Requests are reviewed by a person before the money is sent.
  </p>

  <div class="mt-5">
    {#if success}
      <!--
        The server's own record of the request, not what was typed. `role` is
        Alert's `status` for a success, so it is announced without cutting off
        whatever is being read.
      -->
      <Alert variant="success" title="Your withdrawal request was received">
        {formatPoints(success.amountPoints)} points ·
        {formatCash(success.cashAmountMinor, success.cashCurrency)}
        {success.cashCurrency} to {methodName(success.method)}
        {success.destinationMasked}. Reference {payoutReference(success.id)}. The points are
        reserved until it is reviewed.
      </Alert>
    {/if}

    {#if failure?.message}
      <Alert variant="error" title="Your request was not submitted" class={success ? 'mt-4' : ''}>
        {failure.message}
      </Alert>
    {/if}

    {#if !options}
      <ErrorState
        class={success || failure?.message ? 'mt-4' : ''}
        title="Withdrawal options could not be loaded"
        description="The minimum, the available methods and the conversion rate all come from the server, and it did not answer. Refresh the page to try again."
      />
    {:else if belowMinimum}
      <!--
        The minimum is the API's, quoted rather than judged: the same number
        `POST /payouts` refuses under. `balance` is non-null whenever this
        branch is reached, so the shortfall is a real subtraction.
      -->
      <EmptyState
        class={success || failure?.message ? 'mt-4' : ''}
        icon={Wallet}
        title={balance && balance.available === 0
          ? 'Nothing available to withdraw yet'
          : 'A withdrawal starts at ' + formatPoints(options.minimumPoints) + ' points'}
        description={balance && balance.available === 0
          ? `Complete an offer, and once the reward clears its hold period you can withdraw from ${formatPoints(options.minimumPoints)} points.`
          : `You have ${formatPoints(balance?.available ?? 0)} available — ${formatPoints(options.minimumPoints - (balance?.available ?? 0))} more and you can request a withdrawal.`}
      >
        {#snippet action()}
          <Button href="/offers" size="sm">Browse offers</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <form
        method="POST"
        class="mt-4 flex flex-col gap-4"
        use:enhance={({ cancel }) => {
          /*
           * The button is disabled for the duration, so this guard is the
           * second line: a form can also be submitted with Enter, and a
           * double-tap on a slow connection would otherwise lock the same
           * points twice into two requests an admin then has to reconcile.
           */
          if (submitting) return cancel();
          submitting = true;

          return async ({ result: outcome, update }) => {
            submitting = false;

            // The default behaviour: apply the action result and re-run every
            // load, which is what refreshes the balance above and the history
            // below without a second fetch written here.
            await update();

            if (outcome.type === 'success') {
              amount = null;
              destination = '';
            }
          };
        }}
      >
        <Select
          label="Payout method"
          name="method"
          bind:value={method}
          options={methodOptions}
          error={failure?.fields.method}
          required
        />

        <Input
          label="Amount"
          name="amountPoints"
          type="number"
          inputmode="numeric"
          bind:value={amount}
          min={options.minimumPoints}
          max={effectiveMax}
          step={1}
          error={failure?.fields.amountPoints}
          hint={preview
            ? `${preview} · between ${formatPoints(options.minimumPoints)} and ${formatPoints(effectiveMax)} points`
            : `Between ${formatPoints(options.minimumPoints)} and ${formatPoints(effectiveMax)} points`}
          required
        />

        <Input
          label="Where to send it"
          name="destination"
          bind:value={destination}
          maxlength={200}
          autocomplete="off"
          error={failure?.fields.destination}
          hint="The {methodName(method)} account that receives the money. It is shown to the reviewer and masked everywhere else."
          required
        />

        <Button type="submit" block loading={submitting} disabled={submitting}>
          {#if !submitting}<ArrowDownToLine size={16} aria-hidden="true" />{/if}
          {submitting ? 'Sending your request…' : 'Request withdrawal'}
        </Button>
      </form>
    {/if}
  </div>
</Card>
