/**
 * Which database the integration suite is allowed to touch — TODO T81.
 *
 * D88 gave this suite its own BullMQ prefix, which stopped the development
 * worker and the tests consuming each other's jobs. It did not touch the other
 * half of the problem, and that half is worse: the suite deletes rows.
 * `admin-catalog.spec.ts` alone calls `deleteMany()` on eleven tables, and it
 * ran against whatever `DATABASE_URL` pointed at — which on a developer's
 * machine is the database `docker compose` is serving. One integration file
 * destroys the local admin account, the registered provider, the synced
 * catalog and every account used to verify a feature by hand.
 *
 * That was not a hypothetical: it happened three times while building this
 * phase, each time reading as "the admin password stopped working".
 *
 * ## The rule
 *
 * The suite runs against a database whose **name ends in `_test`**, and if it
 * cannot get one it refuses to run. Not a warning: the failure mode being
 * prevented is silent deletion of somebody's data, and a warning that scrolls
 * past is how that happens anyway.
 *
 * The name is the check rather than "is this different from `DATABASE_URL`",
 * because that comparison passes for any two different databases — including
 * two developer databases, or staging. `_test` is a positive claim about what
 * the database is for, and it is the same claim CI has been making since the
 * pipeline was written: its integration job has always pointed at
 * `gemone_test`.
 *
 * ## Why a separate database rather than a separate schema
 *
 * A schema (`?schema=gemone_test`) would also isolate, and it is one word of
 * configuration rather than a `CREATE DATABASE`. It relies on Prisma setting
 * `search_path` for every connection, and this codebase issues raw SQL —
 * `SELECT id, status FROM conversions ... FOR UPDATE` — whose resolution then
 * depends on that. A separate database has no such dependency: every query
 * behaves exactly as it does in production, which is the property a test
 * environment is for.
 *
 * It is the same Postgres container either way. No compose service was added.
 *
 * ## Why this file lives under `src/`
 *
 * It is test infrastructure, and it sits beside `prisma.service.ts` because its
 * unit test has to run in the **unit** project — the integration project is
 * what this protects, so a guard tested only there is a guard tested by the
 * thing it guards. `loadDotenvForDevelopment` is under `src/` for the same
 * reason and is used the same way.
 */

/** Nothing derived from an environment where the base URL is absent. */
export class MissingDatabaseUrlError extends Error {}

/** A URL that would let the suite delete a non-test database. */
export class UnsafeTestDatabaseError extends Error {}

export interface TestDatabaseEnv {
  DATABASE_URL?: string | undefined;
  TEST_DATABASE_URL?: string | undefined;
}

/**
 * The URL the suite will use, derived or explicit — and never the caller's.
 *
 * `TEST_DATABASE_URL` wins when it is set, which is how a developer or a
 * pipeline points the suite somewhere specific. Otherwise the name in
 * `DATABASE_URL` gets `_test` appended, so a developer who has only ever set
 * up `apps/api/.env` gets isolation with no new configuration at all — which
 * matters, because a safety measure nobody has switched on is not one.
 *
 * A name that already ends in `_test` is used unchanged rather than becoming
 * `gemone_test_test`. That is what lets CI keep setting `DATABASE_URL`
 * directly, as it has since the pipeline was written.
 */
export function resolveTestDatabaseUrl(env: TestDatabaseEnv): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  const resolved = explicit || deriveFrom(env.DATABASE_URL);

  assertIsTestDatabase(resolved);

  return resolved;
}

function deriveFrom(base: string | undefined): string {
  if (!base?.trim()) {
    throw new MissingDatabaseUrlError(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set. The integration suite ' +
        'will not guess which database it may delete from.',
    );
  }

  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (name === '') {
    throw new MissingDatabaseUrlError(
      `DATABASE_URL names no database (${redact(base)}), so no test database can be derived from it.`,
    );
  }

  if (isTestName(name)) return base;

  url.pathname = `/${encodeURIComponent(`${name}_test`)}`;

  return url.toString();
}

function isTestName(name: string): boolean {
  return name.endsWith('_test');
}

/**
 * The guard, applied to whatever was resolved — including an explicit
 * `TEST_DATABASE_URL`.
 *
 * Especially to that one. A variable named "test" is exactly the sort of thing
 * that gets copied from another file with a production value still in it, and
 * the name of the variable is not evidence about the name of the database.
 */
export function assertIsTestDatabase(databaseUrl: string): void {
  let name: string;

  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new UnsafeTestDatabaseError(
      `The integration database URL could not be parsed: ${redact(databaseUrl)}`,
    );
  }

  if (!isTestName(name)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run the integration suite against "${name}": it deletes rows from eleven ` +
        'tables, and the database it deletes from must be named with a "_test" suffix. ' +
        'Set TEST_DATABASE_URL, or point DATABASE_URL at a database whose name ends in "_test".',
    );
  }
}

/** Never print credentials, not even in a failure that nobody will read twice. */
function redact(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    url.password = '';
    url.username = '';
    return url.toString();
  } catch {
    return '<unparseable>';
  }
}
