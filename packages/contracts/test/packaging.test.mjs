/**
 * The build output is the subject — TODO T79.
 *
 * Every other test in this repository imports `@gemone/contracts` from
 * TypeScript source, through a resolver that is happy to reach past the
 * package's own entry points. That is precisely why the packaging defect
 * survived: `svelte-check`, Vitest and `vite dev` all resolved
 * `REWARD_TRANSACTION_TYPES`, and only `vite build` — a Rollup bundle of the
 * CommonJS output — could not, because `__exportStar` copies properties at
 * runtime and leaves nothing statically nameable.
 *
 * So these tests load `dist` the two ways the two consumers load it: `require`
 * for the NestJS API and worker, a real `import` for the SvelteKit build. They
 * are written with `node --test` rather than Vitest deliberately — Vitest would
 * bring its own resolution, and resolution is the thing under test.
 *
 * Run through `pnpm test:unit`, which builds first: a test whose subject is
 * build output has to produce it, or it tests whatever was left behind.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * A value from a *re-exported* module, not from `index.ts` itself.
 *
 * `index.ts` only re-exports, so a constant that survives the round trip proves
 * the `export *` chain works — which is the exact link that broke.
 */
const RUNTIME_VALUE = 'REWARD_TRANSACTION_TYPES';

test('the CommonJS build exports runtime values by name — the API and worker path', () => {
  const require = createRequire(import.meta.url);
  const contracts = require(join(root, manifest.exports['.'].require));

  assert.equal(typeof contracts[RUNTIME_VALUE], 'object');
  assert.equal(contracts[RUNTIME_VALUE].CONVERSION_CREDIT, 'CONVERSION_CREDIT');
  assert.equal(contracts.ERROR_CODES.VALIDATION_FAILED, 'VALIDATION_FAILED');
});

test('the ESM build exports runtime values as static bindings — the web build path', async () => {
  const module = await import(join(root, manifest.exports['.'].import));

  assert.equal(module[RUNTIME_VALUE].CONVERSION_CREDIT, 'CONVERSION_CREDIT');
  assert.equal(module.PAYOUT_STATUSES.PENDING_REVIEW, 'PENDING_REVIEW');
});

/**
 * The property Rollup needs, stated directly.
 *
 * A bundler reads the ESM entry's `export *` statements and follows them to
 * declarations it can name. What it cannot do is enumerate the properties a
 * CommonJS `__exportStar` loop will copy at runtime — the failure this package
 * layout exists to prevent. Asserting on the emitted text is the only way to
 * catch a regression here without running a bundler: change `module` back to
 * `commonjs` and this fails, where a behavioural test still passes because Node
 * itself interoperates fine.
 */
test('the ESM entry re-exports statically, with resolvable specifiers', () => {
  const entry = readFileSync(join(root, manifest.exports['.'].import), 'utf8');

  assert.match(entry, /^export \* from '\.\/rewards\.js';$/m);
  assert.doesNotMatch(entry, /__exportStar|require\(/);

  // Node's ESM resolver does not guess extensions; an extensionless specifier
  // would throw ERR_MODULE_NOT_FOUND on the first import.
  for (const [, specifier] of entry.matchAll(/from '(\.[^']*)'/g)) {
    assert.ok(specifier.endsWith('.js'), `${specifier} has no extension`);
  }
});

test('both builds are marked so Node reads them as the format they are', () => {
  const type = (directory) =>
    JSON.parse(readFileSync(join(root, 'dist', directory, 'package.json'), 'utf8')).type;

  assert.equal(type('cjs'), 'commonjs');
  assert.equal(type('esm'), 'module');
});

test('the types condition resolves for both consumers', () => {
  const declaration = readFileSync(join(root, manifest.exports['.'].types), 'utf8');

  assert.match(declaration, /export \* from '\.\/rewards\.js';/);
});
