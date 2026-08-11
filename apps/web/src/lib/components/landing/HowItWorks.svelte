<!--
  How it works — DESIGN_SYSTEM.md §18.8.

  The signature of this section is one shape: a **112px pale-green circle with
  a 28px brand-500 numbered badge overlapping its top edge**. Nothing else in
  the product uses it.

  The connecting arrow appears only at `md` and above, where the steps are a
  row and an arrow means "next". Stacked at 390px it would point at the floor,
  which is why legacy hides it and this does too.

  The step numbers are real text inside the badge rather than a `counter`, so
  they are read aloud in order.
-->
<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';

  import { Container } from '$lib/components/ui';

  import { STEPS } from './content';
</script>

<section id="how-it-works" class="scroll-mt-16 bg-surface py-16">
  <Container class="text-center">
    <h2 class="font-display text-3xl font-bold text-text">How GemOne works</h2>
    <p class="mt-2 text-text-secondary">Start earning in 3 simple steps</p>

    <ol class="mt-12 flex flex-col items-center justify-center gap-8 md:flex-row md:items-start">
      {#each STEPS as step, index (step.title)}
        <li class="flex flex-col items-center">
          <span class="relative grid size-28 place-items-center rounded-full bg-brand-50 text-5xl">
            <span aria-hidden="true">{step.emoji}</span>
            <span
              class="absolute -top-1 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-brand-500 text-sm font-bold text-text-inverse"
            >
              {index + 1}
            </span>
          </span>

          <h3 class="mt-5 text-base font-bold text-text">{step.title}</h3>
          <p class="mt-1 max-w-[200px] text-sm text-text-secondary">{step.text}</p>
        </li>

        {#if index < STEPS.length - 1}
          <li aria-hidden="true" class="hidden md:block md:mt-10">
            <ArrowRight size={20} class="text-brand-300" />
          </li>
        {/if}
      {/each}
    </ol>
  </Container>
</section>
