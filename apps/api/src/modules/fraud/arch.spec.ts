import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The architecture test for ARCHITECTURE.md §4.2 — *"Why `fraud` Depends on
 * Nothing"*.
 *
 * §4.2 states the rule and the reason: *"The obvious design has `fraud` reading
 * clicks and conversions to score a user, and `conversions` calling `fraud`
 * before crediting — an import cycle, which NestJS resolves with
 * `forwardRef()` and which then quietly makes both modules untestable in
 * isolation. Instead, **`fraud` receives everything it needs as a plain input
 * object.**"*
 *
 * ## Why this needs a test rather than a review
 *
 * The violation is one import line, and it is always the reasonable-looking
 * fix. A rule needs the user's click history, `ClicksService` has it, the
 * import takes three seconds and every test still passes. What it costs is
 * invisible at that moment and only shows up later, as `forwardRef()` in two
 * modules and a rule engine that needs a database to test.
 *
 * The scan reads source text rather than types, for the reason the P2 test
 * gives: a type-level scheme is defeated by `any`, a raw query, or a re-export.
 */

const SRC = resolveSourceRoot();
const FRAUD_DIR = join('modules', 'fraud');
const MODULES_DIR = 'modules';

describe('§4.2 — fraud depends on nothing', () => {
  const sourceFiles = collectTypeScriptFiles(SRC);
  const fraudFiles = sourceFiles.filter((file) => file.relativePath.startsWith(FRAUD_DIR));

  it('finds the files it is supposed to be checking', () => {
    // A scan rooted at nothing finds no offenders and reports success.
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(fraudFiles.length).toBeGreaterThan(3);
  });

  it('imports no other business module', () => {
    /*
     * The whole rule, in one assertion.
     *
     * Every relative import is resolved against the importing file and checked
     * for whether it lands outside `modules/fraud`. Resolved rather than
     * pattern-matched, because `../fraud.config` from `internal/` and
     * `../clicks/clicks.service` from the module root have the same shape and
     * opposite meanings.
     */
    const offenders = fraudFiles.flatMap((file) => {
      const fromDirectory = join(FRAUD_DIR, dirname(relativeToFraud(file.relativePath)));

      return [...file.contents.matchAll(/from\s+'(\.[^']+)'/g)]
        .map((match) => normalize(join(fromDirectory, match[1] ?? '')))
        .filter((target) => target.startsWith(join(MODULES_DIR, sep)))
        .filter((target) => !target.startsWith(FRAUD_DIR))
        .map((target) => `${file.relativePath} → ${target}`);
    });

    expect(offenders).toEqual([]);
  });

  it('reaches no other module through the Nest module graph either', () => {
    /*
     * The import scan above is about files; this is about wiring. A module
     * listed in `imports:` makes its exported providers injectable here, which
     * is the same violation arriving by a different door — and it would not
     * show up as a `../clicks` import path because Nest modules are imported
     * by class name.
     */
    const module = readFileSync(join(SRC, FRAUD_DIR, 'fraud.module.ts'), 'utf8');

    expect(module).not.toMatch(/imports\s*:/);
    // The specific temptation §4.2 names.
    expect(module).not.toContain('forwardRef');
  });

  it('injects no service that moves money', () => {
    /*
     * The other half of the brief: the engine evaluates and records, and money
     * moves through `RewardAccountingService` in the caller's transaction (P2).
     * A fraud service that could credit or reverse directly would be a second
     * path to a balance, and the one least likely to be reviewed.
     *
     * **Comments are stripped for this scan**, unlike the foreign-table scan
     * below and unlike the P2 test. The distinction is deliberate: a comment
     * naming a *table* this module may not read is a step toward reading it,
     * while a comment naming the service that money moves through is the
     * documentation that explains why this module does not. Scanning prose here
     * would delete the explanation to satisfy the rule.
     */
    const offenders = fraudFiles
      .filter((file) => /RewardAccountingService|PayoutsService/.test(stripComments(file.contents)))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });

  it('names no other module’s table, in code or in comments', () => {
    /*
     * DATABASE.md §11.2: *"`fraud` needs velocity counters → does not query
     * `clicks`."* The counters arrive in the context object already counted.
     *
     * Comments are scanned too, as in the provider-independence test: an
     * explanation of how to read another module's table, sitting in a module
     * forbidden from reading it, is the first step of the boundary eroding.
     */
    const foreignTables = [/\bprisma\.click\b/, /\bprisma\.conversion\b/, /\.\bpayoutRequest\b/];

    const offenders = fraudFiles
      .filter((file) => foreignTables.some((pattern) => pattern.test(file.contents)))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });

  it('takes its input as primitives, so the engine needs no database to test', () => {
    /*
     * §4.2's payoff — *"a rule engine testable with plain objects and no
     * database"* — depends entirely on the context type staying free of Prisma
     * models. A `Click` in this interface would compile, would work, and would
     * silently require a database for every rule test thereafter.
     */
    const context = readFileSync(
      join(SRC, FRAUD_DIR, 'contracts', 'fraud-context.ts'),
      'utf8',
    );

    expect(context).not.toMatch(/from\s+'.*generated\/prisma/);
    // No import *statement* at all — the word appears in the prose above, and
    // this is about what the file depends on, not what it explains.
    expect(stripComments(context)).not.toMatch(/^\s*import\s/m);
  });

  it('is the only module that touches fraud_evaluations', () => {
    /*
     * The mirror of the P2 rule, applied to this module's own table. `admin`
     * composes the review screen from `FraudService`, not from the delegate —
     * §4.3 gives it no business logic and no other module's tables.
     */
    const offenders = sourceFiles
      .filter((file) => file.relativePath.startsWith(MODULES_DIR))
      .filter((file) => !file.relativePath.startsWith(FRAUD_DIR))
      .filter((file) => /\.fraudEvaluation\b|\bfraud_evaluations\b/.test(file.contents))
      .map((file) => file.relativePath);

    expect(offenders).toEqual([]);
  });

  it('keeps the rule engine free of the clock', () => {
    /*
     * A pure function of its arguments (§18.4). Reading the time inside a rule
     * would make the same context score differently on a different day, and
     * replaying a historical decision — the reason the context and snapshot are
     * both stored — would stop reproducing it.
     */
    const engine = readFileSync(join(SRC, FRAUD_DIR, 'internal', 'rule-engine.ts'), 'utf8');

    expect(engine).not.toContain('Date.now');
    expect(engine).not.toMatch(/\bnew Date\b/);
    expect(engine).not.toContain('CLOCK');
  });
});

/** A fraud file's path relative to the module root. */
function relativeToFraud(relativePath: string): string {
  return relativePath.slice(FRAUD_DIR.length + 1);
}

/**
 * Removes block and line comments.
 *
 * Crude by design — it is not a parser and does not need to be. Its only job is
 * to stop prose from being read as code by the one scan where the distinction
 * matters, and a string literal it mangles cannot turn a passing file into a
 * failing one for any pattern this file looks for.
 */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
}

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
        if (entry === 'generated' || entry === 'node_modules') continue;
        walk(absolute);
        continue;
      }

      if (!entry.endsWith('.ts')) continue;
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
