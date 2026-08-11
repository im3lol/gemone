<!--
  The hero — DESIGN_SYSTEM.md §18.4.

  ```
  band   bg-gradient-to-b from-brand-50/60 to-white
  inner  grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24
  ```

  The headline is the most recognisable element on the site: `text-5xl` rising
  to `text-6xl` at `sm`, weight 800, leading `1.05`, tracking `-0.025em`, and
  **hand-broken into three lines with the third in brand green**. The breaks are
  literal — the headline is not allowed to reflow — which is why they are `<br>`
  elements and not a `max-w`.

  The two CTAs are `px-6 py-3` at `text-base`, larger than the `sm` pill used
  everywhere else, with the icon *after* the label on the primary and *before*
  it on the secondary.

  ## What replaced the social-proof cluster

  Legacy closes the column with three overlapping avatars, five amber stars and
  "30,000+ happy users". The number is not one we have, and stars with no
  reviews behind them are a rating claim. The same slot now carries three
  statements about how the product works, in the same muted `text-sm` — D82.
-->
<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';
  import Play from '@lucide/svelte/icons/play';

  import { Button, Container } from '$lib/components/ui';

  import PhoneMockup from './PhoneMockup.svelte';

  const PROMISES = ['Free to join', 'Rewards verified before crediting', 'One balance, one rate'];
</script>

<section class="bg-gradient-to-b from-brand-50/60 to-white">
  <Container class="grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
    <div>
      <h1 class="gm-display">
        Earn Rewards.<br />
        Your Way.<br />
        <span class="text-brand-500">Anytime, Anywhere.</span>
      </h1>

      <p class="mt-6 max-w-md text-lg text-text-secondary">
        Complete offers, play games, take surveys and earn real rewards. Turn your time into real
        value with GemOne.
      </p>

      <!--
        `size="lg"` is `0.75rem 1.5rem` at `1rem` — the `px-6 py-3 text-base`
        DS §18.4 specifies for the hero pair, already in the kit. No one-off.
      -->
      <div class="mt-8 flex flex-wrap items-center gap-3">
        <Button href="/register" size="lg">
          Start earning now
          <ArrowRight size={16} aria-hidden="true" />
        </Button>

        <Button href="#how-it-works" variant="secondary" size="lg">
          <Play size={16} aria-hidden="true" />
          How it works
        </Button>
      </div>

      <ul class="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
        {#each PROMISES as promise (promise)}
          <li class="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary">
            <Check size={16} aria-hidden="true" class="text-brand-500" />
            {promise}
          </li>
        {/each}
      </ul>
    </div>

    <PhoneMockup />
  </Container>
</section>
