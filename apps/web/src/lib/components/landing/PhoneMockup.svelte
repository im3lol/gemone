<!--
  The hero visual — DESIGN_SYSTEM.md §18.5.

  A 280px phone with a 10px `slate-900` bezel and a 40px radius, holding a
  miniature of the real dashboard, surrounded by five rotated tiles and two
  sparkles. The rotations (`-12deg`, `6deg`, `-6deg`) are the whole effect:
  square to the grid, the props read as a table of contents.

  ## `aria-hidden`

  The entire block is hidden from assistive technology. It is a picture of the
  product drawn in HTML, and read aloud it becomes "Hi, Ashley, your balance,
  12,560, game mission, plus 1,200" — sample data announced as though it were
  the reader's own. The hero's heading and copy carry the meaning; this carries
  the impression.

  ## The two wordmark tiles

  Legacy's are `PayPal` on `#003087` and `amazon` on `slate-900`. We have no
  relationship with either company and no configured payout method that names
  them — methods are configuration, not code (D43) — so the tiles keep their
  silhouette and their colour contrast with generic labels. Reproducing another
  company's wordmark on a marketing page is a claim, not a layout.
-->
<script lang="ts">
  import { MOCKUP_ACTIVITY } from './content';
</script>

<div aria-hidden="true" class="relative mx-auto h-[520px] w-full max-w-sm select-none">
  <!-- the phone -->
  <div
    class="relative mx-auto w-[280px] rounded-[2.5rem] border-[10px] border-slate-900 bg-surface shadow-2xl"
  >
    <div class="absolute top-0 left-1/2 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-900"></div>

    <div class="space-y-4 p-4 pt-8">
      <p class="text-sm font-semibold text-text">Hi, Ashley! 👋</p>

      <div class="rounded-card bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-text-inverse">
        <p class="text-xs text-white/80">Your balance</p>
        <p class="text-3xl font-bold">12,560</p>
        <p class="text-xs text-white/80">Points</p>
      </div>

      <div class="space-y-1">
        <p class="text-[11px] font-medium text-text-muted">Recent activity</p>

        {#each MOCKUP_ACTIVITY as row (row.label)}
          <div class="flex items-center gap-2 rounded-block bg-surface-muted px-3 py-2">
            <span class="grid size-6 place-items-center rounded-field bg-brand-100 text-[11px]">
              {row.emoji}
            </span>
            <span class="flex-1 text-xs font-medium text-text-body">{row.label}</span>
            <span class="text-xs font-bold text-brand-600">{row.points}</span>
          </div>
        {/each}
      </div>

      <div class="flex justify-around border-t border-border pt-3 text-[10px] text-text-muted">
        <span class="font-semibold text-brand-600">Home</span>
        <span>Earn</span>
        <span>Wallet</span>
        <span>Profile</span>
      </div>
    </div>
  </div>

  <!-- the floating props -->
  <div
    class="absolute top-8 left-0 grid size-16 rotate-[-12deg] place-items-center rounded-card bg-amber-100 text-3xl shadow-lg"
  >
    🎁
  </div>

  <div
    class="absolute bottom-16 left-2 grid size-16 rotate-6 place-items-center rounded-card bg-brand-100 text-3xl shadow-lg"
  >
    🎮
  </div>

  <div
    class="absolute top-16 right-2 grid h-14 w-20 rotate-6 place-items-center rounded-card bg-info-text text-xs font-bold text-text-inverse shadow-lg"
  >
    Cash out
  </div>

  <div
    class="absolute right-0 bottom-24 grid h-14 w-20 -rotate-6 place-items-center rounded-card bg-text px-2 text-center text-xs font-bold text-text-inverse shadow-lg"
  >
    Gift cards
  </div>

  <div
    class="absolute right-10 bottom-4 grid size-14 place-items-center rounded-card bg-amber-300 text-2xl shadow-lg"
  >
    🪙
  </div>

  <span class="absolute top-4 right-16 text-2xl text-brand-400">✦</span>
  <span class="absolute top-40 left-8 text-xl text-brand-300">✦</span>
</div>
