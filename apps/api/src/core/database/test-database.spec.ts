import { describe, expect, it } from 'vitest';

import {
  MissingDatabaseUrlError,
  UnsafeTestDatabaseError,
  assertIsTestDatabase,
  resolveTestDatabaseUrl,
} from './test-database';

/**
 * The guard that decides which database the integration suite may delete from
 * — TODO T81.
 *
 * Beside the module, in the **unit** project: the integration project is the
 * thing being protected, and a guard whose only test needs the guard to
 * already work is not much of a guard. It is also the tier that runs on every
 * PR, where a developer database cannot be harmed by getting this wrong.
 */

const DEV = 'postgresql://gemone:gemone_dev@localhost:5432/gemone?schema=public';

describe('resolveTestDatabaseUrl', () => {
  it('derives a test database from the developer one, so isolation needs no setup', () => {
    // A safety measure nobody has switched on is not a safety measure. A
    // developer who has only ever copied `.env.example` gets this.
    const resolved = resolveTestDatabaseUrl({ DATABASE_URL: DEV });

    expect(new URL(resolved).pathname).toBe('/gemone_test');
  });

  it('keeps everything else about the connection', () => {
    const resolved = new URL(resolveTestDatabaseUrl({ DATABASE_URL: DEV }));

    expect(resolved.host).toBe('localhost:5432');
    expect(resolved.username).toBe('gemone');
    expect(resolved.searchParams.get('schema')).toBe('public');
  });

  it('leaves a name that is already a test database alone', () => {
    // CI has pointed `DATABASE_URL` at `gemone_test` since the pipeline was
    // written. Appending again would send it to `gemone_test_test`, which no
    // migration has ever been applied to.
    const ci = 'postgresql://gemone:gemone_test@localhost:5432/gemone_test';

    expect(resolveTestDatabaseUrl({ DATABASE_URL: ci })).toBe(ci);
  });

  it('prefers an explicit TEST_DATABASE_URL', () => {
    const explicit = 'postgresql://someone:pw@db.internal:5432/other_test';

    expect(resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: explicit })).toBe(
      explicit,
    );
  });

  it('checks an explicit value too, because the variable name is not evidence', () => {
    // "TEST_DATABASE_URL" is exactly the sort of variable that gets copied
    // from another file with a real value still in it.
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@prod.internal:5432/gemone' }),
    ).toThrow(UnsafeTestDatabaseError);
  });

  it('refuses to guess when nothing is configured', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(MissingDatabaseUrlError);
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(MissingDatabaseUrlError);
  });

  it('refuses a URL that names no database', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: 'postgresql://u:p@localhost:5432' })).toThrow(
      MissingDatabaseUrlError,
    );
  });

  it('ignores an empty TEST_DATABASE_URL rather than treating it as a choice', () => {
    // An exported-but-empty variable is a common shell accident, and reading
    // it as "the empty database" would fail somewhere far from the cause.
    expect(new URL(resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: '' })).pathname).toBe(
      '/gemone_test',
    );
  });
});

describe('assertIsTestDatabase', () => {
  it('accepts a name ending in _test', () => {
    expect(() => assertIsTestDatabase('postgresql://u:p@h:5432/anything_test')).not.toThrow();
  });

  it.each([
    ['the developer database', DEV],
    ['something that merely contains test', 'postgresql://u:p@h:5432/testing'],
    ['a production-looking name', 'postgresql://u:p@h:5432/gemone_production'],
    ['a suffix in the wrong place', 'postgresql://u:p@h:5432/test_gemone'],
  ])('refuses %s', (_label, url) => {
    /*
     * The check is the *name*, not "different from DATABASE_URL". That
     * comparison passes for any two different databases — including staging,
     * and including a colleague's. `_test` is a positive claim about what the
     * database is for.
     */
    expect(() => assertIsTestDatabase(url)).toThrow(UnsafeTestDatabaseError);
  });

  it('refuses an unparseable URL rather than falling through', () => {
    expect(() => assertIsTestDatabase('not a url')).toThrow(UnsafeTestDatabaseError);
  });

  it('never puts the password in the failure', () => {
    // The message is printed to a terminal and pasted into issues.
    try {
      assertIsTestDatabase('postgresql://gemone:sup3r-s3cret@localhost:5432/gemone');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain('sup3r-s3cret');
    }
  });
});
