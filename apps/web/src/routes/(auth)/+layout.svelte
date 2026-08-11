<!--
  The public authentication routes — login, register, and the three password /
  verification flows.

  They sit **outside** the application shell on purpose: there is no session to
  put in a topbar and nowhere for a sidebar to navigate to. What this layout
  provides is the page they float in — DESIGN_SYSTEM.md §15.4:

  ```
  main  flex min-h-screen items-center justify-center
        bg-gradient-to-b from-brand-50/60 to-white px-4
  ```

  A `brand-50` wash at 60% fading to white, and nothing else. It is one of only
  three tinted full-bleed surfaces in the product (the hero and the
  testimonials band are the others), and the reason a login screen reads as
  GemOne rather than as a generic form.

  ## What changed in phase 3

  Phase 2 put a header bar here with the logo at the far left and a 24rem form
  column centred underneath — visually orphaned, as its own review recorded.
  The header is gone; the mark now sits inside the card (`AuthCard`), which is
  where DS §19 has it.

  `py-10` is added to legacy's `px-4` so that the tallest card — register, with
  a hint line and an error — keeps clearance from the viewport edge instead of
  being clipped by `items-center` on a short window.
-->
<script lang="ts">
  let { children } = $props();
</script>

<main
  id="main"
  class="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white px-4 py-10"
>
  <div class="w-full max-w-form">
    {@render children()}
  </div>
</main>
