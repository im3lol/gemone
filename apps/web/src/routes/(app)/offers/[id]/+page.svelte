<!--
  One offer — DESIGN_SYSTEM.md §17.1, §10.3.

  ```
  ← All offers
  ┌─────────────────────────────┐ ┌──────────────────┐
  │ ███ tile ███                │ │ 2,450 points     │
  │ Skyline Racer — reach lvl 12│ │ ≈ $2.45 USD      │
  │ [Games] [Multi-step]        │ │ [ Start at Mock ]│
  │ description                 │ │ what happens next│
  │ What you need to do         │ └──────────────────┘
  └─────────────────────────────┘
  ```

  The reward and the button are in their own panel on the right at `lg`, and
  above the description on mobile — the two things the page is being read to
  decide stay together and stay reachable without scrolling past the
  requirements.

  ## The button says where it goes

  "Start at Mock", not "Start this offer". §5.9 of the UI audit lists the
  missing affordance explicitly: pressing this leaves GemOne for a third party,
  and a button that does not say so is a surprise. It stays a `<form method="POST">`
  — the click must be recorded server-side before the redirect, so this cannot
  be a link, and it works with JavaScript off.

  It deliberately does **not** open a new tab. `<form target="_blank">` would,
  and without `rel="noopener"` — which browsers apply inconsistently to forms —
  the provider's page gets a handle on ours. A same-tab redirect the Back
  button undoes is the safer trade for a flow that already leaves the site.
-->
<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  import { OfferTile } from '$lib/components/offers';
  import { Alert, Badge, Button, Card } from '$lib/components/ui';
  import {
    categoryLabel,
    categoryTone,
    formatReward,
    providerName,
  } from '$lib/offers/offer';
  import { approxCash } from '$lib/payouts/payout';

  let { data, form } = $props();

  const offer = $derived(data.offer);
  const provider = $derived(providerName(offer.providerSlug));
  const cash = $derived(
    data.rate
      ? `${approxCash(offer.rewardPoints, data.rate.pointsPerCurrencyUnit, data.rate.currency)} ${data.rate.currency}`
      : null,
  );
</script>

<svelte:head><title>{offer.title} · GemOne</title></svelte:head>

<div class="flex flex-col gap-5">
  <a href="/offers" class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary">
    <ArrowLeft size={16} aria-hidden="true" />
    All offers
  </a>

  {#if form?.message}
    <Alert variant="error" title="This offer could not be started">
      {form.message}
    </Alert>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
    <!-- The reward panel comes first in the DOM so it is first on mobile. -->
    <Card as="section" padding="lg" class="flex flex-col gap-4 lg:order-2">
      <div>
        <p class="text-3xl leading-9 font-bold text-text">{formatReward(offer.rewardPoints)}</p>
        <p class="gm-caption">points{cash ? ` · ${cash}` : ''}</p>
      </div>

      <form method="POST">
        <Button type="submit" block>
          <ExternalLink size={16} aria-hidden="true" />
          Start at {provider}
        </Button>
      </form>

      <p class="gm-subtitle">
        You will be taken to {provider} to complete this offer. Points are credited once the
        provider confirms it, and become withdrawable after the hold period.
      </p>
    </Card>

    <Card as="article" padding="lg" class="flex flex-col gap-4 lg:order-1">
      <OfferTile {offer} class="h-40" />

      <div class="flex flex-col gap-2">
        <h1 class="font-display text-2xl font-bold tracking-tight text-text">{offer.title}</h1>

        <p class="flex flex-wrap gap-1">
          <Badge variant={categoryTone(offer.category)}>{categoryLabel(offer.category)}</Badge>
          {#if offer.isMultiStep}
            <Badge variant="neutral">Multi-step</Badge>
          {/if}
          <Badge variant="neutral">{provider}</Badge>
        </p>
      </div>

      {#if offer.description}
        <p class="text-text-secondary">{offer.description}</p>
      {/if}

      {#if offer.requirements}
        <div>
          <h2 class="gm-card-title">What you need to do</h2>
          <p class="gm-subtitle mt-1 whitespace-pre-line">{offer.requirements}</p>
        </div>
      {/if}

      <!--
        Countries and devices are what the *provider* declared, not a gate we
        enforce — the wall contract is explicit that eligibility stays the
        provider's business at conversion time. Shown as information, worded so
        it does not read as a promise that a match will be paid.
      -->
      {#if offer.devices.length > 0 || offer.countries.length > 0}
        <dl class="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {#if offer.devices.length > 0}
            <div class="flex flex-wrap gap-2">
              <dt class="text-text-secondary">Provider lists it for</dt>
              <dd class="font-medium text-text">{offer.devices.join(', ')}</dd>
            </div>
          {/if}
          {#if offer.countries.length > 0}
            <div class="flex flex-wrap gap-2">
              <dt class="text-text-secondary">In</dt>
              <dd class="font-medium text-text">{offer.countries.join(', ')}</dd>
            </div>
          {/if}
        </dl>
      {/if}
    </Card>
  </div>
</div>
