import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit configuration — ARCHITECTURE.md §6.1, §20.
 *
 * `adapter-node` because this ships as a container behind Caddy (§19.1), not
 * to a serverless platform. It is also what makes the BFF possible at all: the
 * session cookie is read and exchanged for a bearer token in a Node process we
 * run, which is the entire point of proxying (P4 — one VPS, no vendor
 * runtime).
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    /*
     * Origin checking on form posts is left at SvelteKit's default, which is
     * on. Behind Caddy that requires `ORIGIN` to name the public address, or
     * every form submission is rejected as cross-site (§19.1).
     */
    adapter: adapter(),
  },
};

export default config;
