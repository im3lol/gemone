import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Boundaries that are only documented are boundaries that erode
 * (ARCHITECTURE.md §4.4). These rules are mechanism one of three: lint
 * failures fail CI.
 *
 * The rules encoded here are §5's dependency directions:
 *   1. `shared` imports nothing from the project.
 *   2. `core` may import `shared`; `core` must never import `modules`.
 *   3. `modules` import `core`, `shared`, and other modules' exported services.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      // Generated Prisma client. Linting machine-written code produces
      // findings nobody can act on, since the fix would be overwritten by the
      // next `prisma generate`.
      'apps/api/src/generated/**',
      // SvelteKit's generated route types and the adapter's build output, for
      // the same reason: machine-written code whose findings would be
      // overwritten by the next `svelte-kit sync`.
      '**/.svelte-kit/**',
      'apps/web/build/**',
      '**/*.js',
      '**/*.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `consistent-type-imports` is deliberately NOT enabled.
      //
      // NestJS resolves constructor dependencies from `emitDecoratorMetadata`,
      // which requires the class to be a *runtime* import. Rewriting
      // `import { HealthService }` to `import type { HealthService }` — which
      // the rule does, because the symbol only appears in type position —
      // erases the metadata and breaks dependency injection at runtime, with
      // no compile error. A lint rule that silently breaks DI is worse than
      // the inconsistency it fixes.
      //
      // Type-only imports are still written by hand where they are clearly
      // types (`import type { Response } from 'express'`).
      // Business rule values must come from ConfigurationService, never a
      // literal (§5, rule 8). Magic numbers in domain code are how hardcoded
      // rules survive.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Inject a clock instead of calling new Date() — untestable time is untestable hold periods.',
        },
      ],
    },
  },

  // Boundary enforcement for the API application.
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Required: the plugin resolves imports through eslint-module-utils,
      // whose default node resolver does not know about `.ts`. Without this,
      // every internal import resolves to nothing, every dependency is
      // classified "unknown", and the boundary rules silently pass on code
      // that violates them — the worst possible failure mode for a rule whose
      // entire job is to fail.
      'import/resolver': { node: { extensions: ['.ts', '.js', '.json'] } },

      'boundaries/elements': [
        { type: 'shared', pattern: 'apps/api/src/shared/*', mode: 'folder' },
        { type: 'core', pattern: 'apps/api/src/core/*', mode: 'folder' },

        /*
         * The three provider sub-elements are declared BEFORE the generic
         * `module` element, because the plugin classifies a file by the first
         * pattern that matches it. Listed after, every one of these would be
         * swallowed by `modules/*` and rules 6 and 7 of §5 would have no
         * mechanism behind them at all.
         */
        {
          type: 'provider-adapter',
          pattern: 'apps/api/src/modules/providers/adapters/*',
          mode: 'folder',
          capture: ['adapterName'],
        },
        {
          type: 'provider-registry',
          pattern: 'apps/api/src/modules/providers/registry',
          mode: 'folder',
        },
        {
          type: 'provider-contracts',
          pattern: 'apps/api/src/modules/providers/contracts',
          mode: 'folder',
        },

        {
          type: 'module',
          pattern: 'apps/api/src/modules/*',
          mode: 'folder',
          capture: ['moduleName'],
        },
        { type: 'jobs', pattern: 'apps/api/src/jobs', mode: 'folder' },
        { type: 'root', pattern: 'apps/api/src/*.ts', mode: 'full' },
      ],
    },
    rules: {
      // String selectors emit a "legacy syntax" advisory on 6.0.2. The
      // object-based replacement the notice points at is rejected by the
      // plugin's own options schema in this version, so strings stay until
      // upstream settles. The rule itself works correctly either way.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            // shared imports nothing from the project.
            { from: 'shared', allow: [] },

            // core may import shared. Never modules — if a core service needs
            // domain knowledge, the design is wrong; invert it.
            { from: 'core', allow: ['shared', 'core'] },

            /*
             * An adapter imports `shared` and the provider contracts.
             * NOTHING else (§7.2, rule 2).
             *
             * Not even `core`: an adapter that could reach `core/database` or
             * `core/cache` would stop being the stateless translator §7.2
             * rule 1 requires, and the first one to hold state makes "which
             * replica handled it" start mattering.
             */
            { from: 'provider-adapter', allow: ['shared', 'provider-contracts'] },

            // The contracts define the vocabulary; they reach core for the
            // error taxonomy the normalized provider errors extend.
            { from: 'provider-contracts', allow: ['shared', 'core'] },

            // The registry is the ONLY element permitted to import a concrete
            // adapter (§5, rule 6). This single line is the mechanism behind
            // P1; provider-independence.spec.ts is the second one.
            {
              from: 'provider-registry',
              allow: ['core', 'shared', 'module', 'provider-contracts', 'provider-adapter'],
            },

            /*
             * Modules import core, shared, and other modules — plus the
             * provider contracts and registry, which are how the rest of the
             * platform reaches a provider.
             *
             * Note the absence of `provider-adapter`. That omission is rule 6.
             */
            {
              from: 'module',
              allow: ['core', 'shared', 'module', 'provider-contracts', 'provider-registry'],
            },

            // jobs orchestrate; they may reach everything below them, with
            // the same exception — a job resolves an adapter through the
            // registry, never by importing one.
            {
              from: 'jobs',
              allow: ['core', 'shared', 'module', 'provider-contracts', 'provider-registry'],
            },

            // entrypoints wire the graph together.
            {
              from: 'root',
              allow: [
                'core',
                'shared',
                'module',
                'jobs',
                'root',
                'provider-contracts',
                'provider-registry',
              ],
            },
          ],
        },
      ],
    },
  },

  // Tests describe behaviour; they are allowed to be less strict about the
  // shapes they construct to exercise it.
  {
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
