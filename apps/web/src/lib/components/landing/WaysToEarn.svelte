<!--
  Ways to earn — DESIGN_SYSTEM.md §18.9.

  Six tinted tiles at `sm:grid-cols-2 lg:grid-cols-6`, **no border and no
  shadow** — the tint is the whole surface. The icon plate is `bg-white/70`,
  translucent over the tint, with `shadow-sm`; a solid white plate loses the
  effect entirely.

  This row is the app's semantic palette used decoratively, and reproducing the
  exact pairs is what makes it recognisable. The one substitution is recorded
  in `content.ts`: the emerald tile uses brand tokens, because Tailwind v4's
  own `emerald` is a different green from the brand scale (D79) and the two
  would sit side by side in the same row.

  **The tile button is a real link here.** Legacy's "Explore" is a `<button>`
  that does nothing and has no hover state (DS §18.16, flagged there as an
  omission). Each one now goes to registration, which is what exploring
  requires.
-->
<script lang="ts">
  import { Container } from '$lib/components/ui';

  import { EARNING_TILES } from './content';
</script>

<section id="ways-to-earn" class="scroll-mt-16 bg-surface py-16">
  <Container>
    <div class="text-center">
      <h2 class="font-display text-3xl font-bold text-text">Many ways to earn</h2>
      <p class="mt-2 text-text-secondary">Choose what you like and start earning</p>
    </div>

    <ul class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
      {#each EARNING_TILES as tile (tile.title)}
        <li class="rounded-card p-5 text-center {tile.tile}">
          <span
            class="mx-auto grid size-16 place-items-center rounded-card bg-white/70 text-3xl shadow-sm"
            aria-hidden="true"
          >
            {tile.emoji}
          </span>

          <h3 class="mt-4 text-sm font-bold text-text">{tile.title}</h3>
          <p class="mt-1 text-xs text-text-secondary">{tile.text}</p>

          <a
            href="/register"
            class="mt-4 block rounded-field py-1.5 text-xs font-semibold hover:no-underline hover:brightness-95 {tile.button}"
          >
            Explore
            <span class="gm-sr-only">{tile.title}</span>
          </a>
        </li>
      {/each}
    </ul>
  </Container>
</section>
