<!--
  The features row — DESIGN_SYSTEM.md §18.7.

  Five equal cards, `grid gap-5 sm:grid-cols-2 lg:grid-cols-5`, each with a
  48px **solid `brand-500`** icon tile above centred text. That solid tile is
  the point: everywhere else in the product an icon sits on a pale tint, and
  this is the one row that fills it.

  The cards are the kit's `Card` at `padding="lg"` — `p-6`, the size DS
  specifies — so the hairline, radius and shadow come from the same rule as
  every other card rather than being restated here.
-->
<script lang="ts">
  import { Card, Container } from '$lib/components/ui';

  import { FEATURES } from './content';
</script>

<section id="features" class="scroll-mt-16 bg-surface py-12">
  <Container class="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
    {#each FEATURES as feature (feature.title)}
      {@const Icon = feature.icon}
      <Card as="article" padding="lg" class="text-center">
        <span
          class="mx-auto grid size-12 place-items-center rounded-block bg-brand-500 text-text-inverse"
        >
          <Icon size={24} aria-hidden="true" />
        </span>

        <h3 class="mt-4 text-sm font-bold text-text">{feature.title}</h3>
        <p class="mt-1 text-xs text-text-secondary">{feature.text}</p>
      </Card>
    {/each}
  </Container>
</section>
