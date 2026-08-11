import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /*
   * Tailwind before SvelteKit: the plugin has to see `src/app.css` as a CSS
   * entry before Svelte's compiler starts pulling `<style>` blocks through the
   * same pipeline. The token layer itself lives in that file, not here — there
   * is no `tailwind.config.js` in v4 (docs/UI_KIT.md).
   */
  plugins: [tailwindcss(), sveltekit()],
  test: {
    /*
     * Server-side units only — ARCHITECTURE.md §18.
     *
     * What is worth testing here is the part that holds a session and talks to
     * the API: cookie handling and the refresh exchange. Component rendering
     * is not, at this size; a test that asserts a heading exists is a test that
     * fails when the copy changes and passes when the flow breaks.
     */
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
