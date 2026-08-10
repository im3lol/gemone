import { readFileSync, readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The architecture test for P2 — ARCHITECTURE.md §4.4, mechanism three.
 *
 * §4.4 calls it out by name: *"an architecture test (`arch.spec.ts`) asserts
 * that no file outside `modules/rewards/` references the `user_balances` or
 * `reward_transactions` Prisma models (P2). **This is the single most
 * important rule in the codebase**, so it gets its own dedicated test rather
 * than sharing a lint config."*
 *
 * ## Why it is the most important rule
 *
 * PROJECT.md R5 names the realistic failure, and it is not a bad migration: it
 * is that the simple balance model quietly becomes permanent, the discipline
 * erodes, and direct balance access creeps into business rules until the
 * migration path is gone. Nothing about that failure is visible in review — one
 * convenience join in a reporting query looks entirely reasonable, and the
 * option P2 bought is spent the moment it lands.
 *
 * ## Why greps rather than types
 *
 * A type-level scheme would be cleverer and would be defeated by `any`, by a
 * raw query, or by someone exporting a delegate. This reads the source text,
 * so it fails on the shape of the mistake rather than on its type.
 *
 * The scans include comments deliberately, for the same reason the provider
 * independence test does: an explanation naming a balance table in code that
 * has no business touching one is the first step of the boundary eroding.
 */

const SRC = resolveSourceRoot();
const REWARDS_DIR = join('modules', 'rewards');

/**
 * Every way the Prisma client exposes these tables.
 *
 * Written as the property access rather than as the model name alone, so that
 * a mention in prose does not fail the build while `prisma.userBalance` does.
 */
const BALANCE_DELEGATES = [/\.userBalance\b/, /\.rewardTransaction\b/];

/** The tables themselves, for raw SQL — where a delegate name never appears. */
const BALANCE_TABLES = [/\buser_balances\b/, /\breward_transactions\b/];

describe('P2 — only modules/rewards touches balance state', () => {
  const sourceFiles = collectTypeScriptFiles(SRC);

  it('finds the source tree it is supposed to be checking', () => {
    /*
     * A test that silently scans zero files passes forever, which for this
     * rule would mean the most important guarantee in the system quietly
     * checking nothing. This is the guard that makes every assertion below
     * mean something.
     */
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(sourceFiles.some((file) => file.relativePath.startsWith(REWARDS_DIR))).toBe(true);
  });

  it('has no Prisma balance access outside modules/rewards', () => {
    const offenders = sourceFiles
      .filter((file) => !file.relativePath.startsWith(REWARDS_DIR))
      .filter((file) => BALANCE_DELEGATES.some((pattern) => pattern.test(file.contents)))
      .map((file) => file.relativePath);

    /*
     * The moment this fails, P2 is over — not gradually, immediately. One
     * `prisma.userBalance.findUnique` in an admin service means the balance is
     * now read from two places, and the second one does not take the row lock
     * that makes the first correct.
     */
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL naming the balance tables outside modules/rewards', () => {
    // The delegate check cannot see `SELECT ... FROM user_balances`, and raw
    // SQL is exactly how someone works around an abstraction they find
    // inconvenient.
    const offenders = sourceFiles
      .filter((file) => !file.relativePath.startsWith(REWARDS_DIR))
      .filter((file) => BALANCE_TABLES.some((pattern) => pattern.test(file.contents)))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });

  it('keeps the balance off the user model', () => {
    /*
     * DATABASE.md §3.1: `users` deliberately carries no balance. A `points`
     * column there would be the mutable-balance-in-the-wrong-place mistake P2
     * exists to prevent, and it would be invisible to the checks above because
     * it needs no new table and no new delegate.
     */
    const schema = readFileSync(join(SRC, '..', 'prisma', 'schema.prisma'), 'utf8');
    const userModel = schema.slice(
      schema.indexOf('model User {'),
      schema.indexOf('model RefreshToken {'),
    );

    expect(userModel).not.toMatch(/\bpoints\b/i);
    expect(userModel).not.toMatch(/\bbalance\s+Int/i);
  });

  it('exposes no way to reach balance storage through the module', () => {
    /*
     * The service is the boundary; exporting anything else from the module
     * would route around it. Exporting `PrismaService` from here, for example,
     * would satisfy every check above while handing out the delegate.
     */
    const module = readFileSync(join(SRC, REWARDS_DIR, 'rewards.module.ts'), 'utf8');
    const exportsBlock = module.slice(module.indexOf('exports:'));

    expect(exportsBlock).toContain('RewardAccountingService');
    expect(exportsBlock).not.toContain('PrismaService');
  });

  it('records every movement, so history can explain the balance', () => {
    /*
     * PROJECT.md §4.5: "Every mutation is recorded, even under the simple
     * balance model." The balance write and the history write live in one
     * private method for exactly that reason — a second write path is how a
     * balance moves with nothing behind it, and drift with no cause is the
     * failure R5 says should trigger the migration.
     */
    const service = readFileSync(
      join(SRC, REWARDS_DIR, 'reward-accounting.service.ts'),
      'utf8',
    );

    const balanceUpdates = service.match(/\.userBalance\.update\(/g) ?? [];
    expect(balanceUpdates).toHaveLength(1);

    const historyWrites = service.match(/\.rewardTransaction\.create\(/g) ?? [];
    expect(historyWrites).toHaveLength(1);
  });
});

/**
 * Resolves `apps/api/src`, whether the suite runs from the package or the
 * repository root.
 *
 * Throws rather than returning a path that does not exist: a scan rooted at
 * nothing finds no offenders and reports success, which is the one outcome
 * this file must never produce by accident.
 */
function resolveSourceRoot(): string {
  const candidates = [join(process.cwd(), 'src'), join(process.cwd(), 'apps', 'api', 'src')];
  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error(`Could not locate the API source root. Tried: ${candidates.join(', ')}`);
  }

  return found;
}

interface SourceFile {
  relativePath: string;
  contents: string;
}

function collectTypeScriptFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);

      if (statSync(absolute).isDirectory()) {
        // Machine-written, overwritten by every `prisma generate`, and full of
        // the very names this file looks for.
        if (entry === 'generated' || entry === 'node_modules') continue;
        walk(absolute);
        continue;
      }

      if (!entry.endsWith('.ts')) continue;
      // Tests construct and clean up whatever they need to exercise the rule.
      if (entry.endsWith('.spec.ts')) continue;

      files.push({
        relativePath: relative(root, absolute).split(sep).join(sep),
        contents: readFileSync(absolute, 'utf8'),
      });
    }
  };

  walk(root);

  return files;
}
