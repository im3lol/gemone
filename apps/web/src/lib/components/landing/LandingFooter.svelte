<!--
  The public footer — DESIGN_SYSTEM.md §18.13.

  ```
  footer  border-t border-slate-100 bg-white py-12
  grid    grid gap-10 md:grid-cols-[1.4fr_repeat(n,1fr)]
  ```

  Legacy has four link columns — Platform, Company, Support, Legal — carrying
  eighteen links of which **three resolve**; the rest are `href="#"`. Those
  pages do not exist here either, and shipping fifteen links to nowhere is
  copying a defect, not a design. Two columns are kept, both of them real, and
  the brand column widens to `1.4fr` against them exactly as the grid formula
  says. Legal pages are TODO T76.

  The row of social circles is dropped for the same reason: there are no
  accounts behind them.
-->
<script lang="ts">
  import { Logo } from '$lib/components/shell';
  import { Container } from '$lib/components/ui';

  import { FOOTER_COLUMNS } from './content';
</script>

<footer class="border-t border-border bg-surface py-12">
  <Container>
    <div class="grid gap-10 md:grid-cols-[1.4fr_repeat(2,1fr)]">
      <div>
        <Logo />
        <p class="mt-4 max-w-xs text-sm text-text-secondary">
          Earn rewards. Your way. Anytime, anywhere.
        </p>
      </div>

      {#each FOOTER_COLUMNS as column (column.heading)}
        <nav aria-label={column.heading}>
          <h2 class="text-sm font-bold text-text">{column.heading}</h2>
          <ul class="mt-4 flex flex-col gap-2.5">
            {#each column.links as link (link.href)}
              <li>
                <a href={link.href} class="text-sm text-text-secondary hover:text-text">
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
      {/each}
    </div>

    <p class="mt-10 border-t border-border pt-6 text-center text-sm text-text-muted">
      © 2026 GemOne. All rights reserved.
    </p>
  </Container>
</footer>
