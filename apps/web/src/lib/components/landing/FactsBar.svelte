<!--
  The dark slab — DESIGN_SYSTEM.md §18.11.

  The only dark surface on the public site: `rounded-3xl` (24px, larger than
  every card in the product) filled with a **horizontal** `brand-800 →
  brand-950` gradient, four centred cells, labels in `brand-100` at 80% rather
  than white.

  Legacy's four figures are "30,000+ Active Users · $2M+ Paid to Users · 1M+
  Offers Completed · 50+ Reward Options". We have none of those numbers, and a
  landing page that invents them is making a claim rather than reproducing a
  design. These four are properties of the product as built — see `content.ts`
  and D82.
-->
<script lang="ts">
  import { Container } from '$lib/components/ui';

  import { FACTS } from './content';
</script>

<section class="bg-surface pt-8 pb-4">
  <Container>
    <dl
      class="grid gap-6 rounded-3xl bg-gradient-to-r from-brand-800 to-brand-950 px-8 py-10 sm:grid-cols-2 lg:grid-cols-4"
    >
      <!--
        `flex-col-reverse` puts the value above its label on screen while the
        markup keeps `dt` before `dd`. Writing it the other way round would
        need the label repeated in a hidden `dt`, and every cell would then be
        announced twice.
      -->
      {#each FACTS as fact (fact.label)}
        <div class="flex flex-col-reverse text-center text-text-inverse">
          <dt class="mt-1 text-sm text-brand-100/80">{fact.label}</dt>
          <dd class="font-display text-3xl font-extrabold">{fact.value}</dd>
        </div>
      {/each}
    </dl>
  </Container>
</section>
