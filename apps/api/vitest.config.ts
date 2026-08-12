import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, matching ARCHITECTURE.md §18's tiers.
 *
 * `unit` runs everywhere, including CI on every PR. `integration` needs a real
 * Postgres and a real Redis (§18.3) and is therefore separate — the parts most
 * likely to be wrong are the parts where code meets the database, and none of
 * those can be tested with a mock.
 *
 * The SWC plugin is required because NestJS relies on decorator metadata,
 * which esbuild (Vitest's default transformer) does not emit.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',

    /*
     * One database, one file at a time.
     *
     * The integration suites reset shared tables between tests. Run in
     * parallel, one file truncates `users` while another is mid-flow against
     * them, which surfaces as foreign-key violations that look like
     * application bugs and are not.
     *
     * Set at the ROOT rather than per project: Vitest resolves file
     * parallelism for the whole run, so a per-project value is ignored — a
     * subtlety that cost a debugging cycle here.
     *
     * ARCHITECTURE.md §18.3 describes the better answer — each test in a
     * transaction that rolls back — which needs the application to run inside
     * a caller-supplied transaction. Serial execution is the simpler thing
     * that is correct today (P6); revisit when the suite is slow enough for
     * anyone to notice.
     */
    fileParallelism: false,

    projects: [
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          root: import.meta.dirname,
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['test/integration/**/*.spec.ts'],
          /*
           * Creates and migrates the isolated test database, once, before any
           * file loads — TODO T81. `setupFiles` runs per file and would race;
           * this hook runs once in one process (see `global-setup.ts`).
           */
          globalSetup: ['test/integration/global-setup.ts'],
          setupFiles: ['test/integration/setup.ts'],
          root: import.meta.dirname,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
