<!--
  The faint strip under the hero — DESIGN_SYSTEM.md §18.6.

  ```
  section  border-y border-slate-100 bg-white py-10
  label    text-center text-sm font-medium
  row      mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4
  name     text-lg font-semibold
  ```

  Legacy's row is six offer networks under "Trusted by top offer partners". We
  have integrated none of them — `providers/adapters` contains `mock` — so the
  band keeps its shape and states what every provider is put through instead.
  That is P1 in the shop window: the pipeline is ours, the networks plug into
  it. See D82.

  **One colour deviation.** Legacy uses `text-slate-300` (#cad5e2), the
  lightest text on the site, and gets away with it because those words are
  wordmarks — decoration a reader loses nothing by missing. These are real
  content at 1.5:1 on white, so they are one step darker at `text-muted`
  (#90a1b9). Still the faintest thing on the page, still recedes.
-->
<script lang="ts">
  import { Container } from '$lib/components/ui';

  import { PIPELINE_STAGES } from './content';
</script>

<section class="border-y border-border bg-surface py-10">
  <Container>
    <p class="text-center text-sm font-medium text-text-muted">
      Every network we connect goes through the same pipeline
    </p>

    <ul class="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
      {#each PIPELINE_STAGES as stage (stage)}
        <li class="text-lg font-semibold text-text-muted">{stage}</li>
      {/each}
    </ul>
  </Container>
</section>
