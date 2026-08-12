/**
 * Tells Node what each build output is.
 *
 * `tsc` emits JavaScript and nothing else — it does not mark the directory it
 * wrote. Node decides whether a `.js` file is a module or a script by walking
 * up to the nearest `package.json` and reading its `type`, and the nearest one
 * to `dist/esm` would otherwise be this package's own, which is CommonJS. The
 * ESM build would then be parsed as CommonJS and fail on its first `export`.
 *
 * Two one-line files fix that, and they are generated rather than committed
 * because they belong to `dist/`, which is build output.
 *
 * The CommonJS marker is redundant today — it restates the default. It is
 * written anyway so that adding `"type": "module"` to this package later
 * changes one file instead of silently reinterpreting the other build.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');

for (const [directory, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  writeFileSync(join(dist, directory, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
