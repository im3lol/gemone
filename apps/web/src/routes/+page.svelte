<!--
  The landing page — DESIGN_SYSTEM.md §18.

  `app/page.tsx` in legacy is a flat list of bands on `bg-white`, and so is
  this. Every section is full-bleed and centres its own content at 72rem; the
  order is the page's rhythm and §18.2 is the authority on it.

  Two bands differ from legacy in *content* rather than shape — the strip under
  the hero and the tinted band of cards — and one, the dark slab, keeps its
  four cells with different figures. Each one carries its reason in its own
  file; the rule behind all three is at the top of `landing/content.ts` and in
  D82.

  ## The skip link

  Same reason as the application shell: without it, reaching the page content
  by keyboard means tabbing through the header on every visit. `<main>` carries
  `tabindex="-1"` so that activating it actually moves focus rather than only
  the scroll position.
-->
<script lang="ts">
  import {
    CtaBanner,
    FactsBar,
    Features,
    Guarantees,
    Hero,
    HowItWorks,
    LandingFooter,
    LandingNav,
    PipelineStrip,
    WaysToEarn,
  } from '$lib/components/landing';

  let { data } = $props();
</script>

<svelte:head>
  <title>GemOne — earn rewards your way</title>
  <meta
    name="description"
    content="Complete offers, play games and take surveys from every connected network on one wall, with a single points balance and rewards verified before they are credited."
  />
</svelte:head>

<a
  href="#main"
  class="gm-btn gm-btn--primary gm-btn--sm sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
>
  Skip to content
</a>

<div class="flex min-h-screen flex-col bg-surface">
  <LandingNav authenticated={data.authenticated} />

  <main id="main" tabindex="-1" class="flex-1">
    <Hero />
    <PipelineStrip />
    <Features />
    <HowItWorks />
    <WaysToEarn />
    <Guarantees />
    <FactsBar />
    <CtaBanner />
  </main>

  <LandingFooter />
</div>
