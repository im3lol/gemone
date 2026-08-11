<!--
  The closing call to action — DESIGN_SYSTEM.md §18.12.

  `rounded-3xl`, `bg-brand-50`, **no border and no shadow** — the flat tinted
  slab that answers the dark one above it. Stacked and centred below `md`, a
  row with the button on the right above it.

  The reassurance line under the button is legacy's and it is doing work: it is
  the only place on the page that says how long signing up takes.
-->
<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';

  import { Button, Container } from '$lib/components/ui';
</script>

<section class="bg-surface py-14">
  <Container>
    <div
      class="flex flex-col items-center gap-6 rounded-3xl bg-brand-50 px-8 py-10 text-center md:flex-row md:justify-between md:text-left"
    >
      <div class="flex items-center gap-5">
        <span aria-hidden="true" class="text-6xl">🧰</span>
        <div>
          <h2 class="font-display text-2xl font-bold text-text">Ready to start earning?</h2>
          <p class="mt-1 text-text-secondary">
            Create a free account and start completing offers today.
          </p>
        </div>
      </div>

      <div class="shrink-0">
        <Button href="/register" size="lg">
          Sign up for free
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
        <p class="mt-2 text-xs text-text-muted">It takes less than a minute.</p>
      </div>
    </div>
  </Container>
</section>
