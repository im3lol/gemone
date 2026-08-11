<!--
  The tinted band — DESIGN_SYSTEM.md §18.10.

  The band and the card are legacy's, exactly: a `brand-50/70 → brand-50/30`
  vertical gradient, three white cards at `gap-6` (wider than the page's usual
  `gap-5`), each a round plate, a bold heading, a body, and a `border-t` footer
  row with a coloured lead on the left and a muted label on the right.

  **The content is not legacy's, and that is deliberate.** §18.10 is three
  signed testimonials — names, five-star rows, and payout amounts in inline
  hex colours — and they are invented. A fabricated review published as a real
  one is the one thing on a marketing page that is not a matter of taste, so
  the same three cards carry what the reward model actually guarantees
  (ARCHITECTURE.md §9–§11). D82.
-->
<script lang="ts">
  import { Card, Container } from '$lib/components/ui';

  import { GUARANTEES } from './content';
</script>

<section class="bg-gradient-to-b from-brand-50/70 to-brand-50/30 py-16">
  <Container>
    <div class="text-center">
      <h2 class="font-display text-3xl font-bold text-text">Built on rewards you can check</h2>
      <p class="mt-2 text-text-secondary">
        How GemOne makes sure what you earn is what you get
      </p>
    </div>

    <ul class="mt-10 grid gap-6 md:grid-cols-3">
      {#each GUARANTEES as item (item.title)}
        {@const Icon = item.icon}
        <li>
          <Card as="article" padding="lg" class="flex h-full flex-col text-left">
            <div class="flex items-center gap-3">
              <span class="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3 class="text-sm font-bold text-text">{item.title}</h3>
            </div>

            <p class="mt-4 flex-1 text-sm text-text-body">{item.text}</p>

            <div class="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span class="text-sm font-bold text-brand-600">{item.lead}</span>
              <span class="text-xs text-text-muted">{item.trail}</span>
            </div>
          </Card>
        </li>
      {/each}
    </ul>
  </Container>
</section>
