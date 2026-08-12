import { execFileSync } from 'node:child_process';

import { loadDotenvForDevelopment } from '../../src/core/config/load-dotenv';
import { resolveTestDatabaseUrl } from '../../src/core/database/test-database';

/**
 * Brings the test database into existence and up to date, once per run —
 * TODO T81.
 *
 * Vitest runs `globalSetup` a single time in a single process, before any test
 * file loads. That is the only hook where a migration can go: `setupFiles` run
 * per test file, so `migrate deploy` there would be thirty invocations racing
 * to apply the same migrations, and `beforeAll` in a spec would be later still
 * — the application has already connected by then.
 *
 * `prisma migrate deploy` creates the database when it does not exist and is a
 * no-op when it is current, so a developer with a fresh checkout runs the
 * suite and it works, with no setup step to forget. That is deliberate: the
 * isolation this exists for is only real if it is the *default* path rather
 * than one that has to be switched on.
 *
 * `deploy`, never `dev`: `migrate dev` can author a migration, and a test run
 * that can write a migration is a test run that can hide a schema change
 * nobody reviewed. It is the same reason CI uses `deploy`.
 *
 * The URL is resolved by `resolveTestDatabaseUrl`, which refuses anything not
 * named `*_test` — so this cannot be the thing that migrates a developer's
 * database, and the run fails here rather than three files later.
 */
export default function setup(): void {
  loadDotenvForDevelopment();

  const databaseUrl = resolveTestDatabaseUrl(process.env);

  /*
   * `execFileSync`, not `execSync`: the URL contains a password and a shell
   * would be one quoting mistake away from mangling it — or from interpreting
   * it. `stdio: 'pipe'` keeps Prisma's banner out of the test output, and the
   * failure below prints what it said, because a migration failure with no
   * output is a support ticket.
   */
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';

    throw new Error(
      `Could not prepare the integration database.\n${stdout}\n${output}`.trim(),
    );
  }
}
