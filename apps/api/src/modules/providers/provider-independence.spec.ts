import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROVIDER_ADAPTERS } from './registry/adapter-map';

/**
 * The architecture test for P1 — ARCHITECTURE.md §4.4, mechanism three.
 *
 * §5 rules 6 and 7 are the two claims the whole provider architecture rests
 * on: nothing outside the registry imports a concrete adapter, and nothing
 * outside an adapter's folder contains that provider's name. Both are
 * *greppable* claims, so they get a test that greps rather than a paragraph
 * asking people to be careful.
 *
 * `eslint-plugin-boundaries` enforces rule 6 too, and that overlap is
 * deliberate. A lint rule can be disabled with a comment, an element pattern
 * can stop matching after a folder rename, and — as this repository has
 * already learned once — a misconfigured resolver makes a boundary rule pass
 * on code that violates it, which is the worst possible failure for a rule
 * whose entire job is to fail. Two independent mechanisms, one of which reads
 * the actual file contents.
 *
 * The scans deliberately read raw text, comments included. A comment in
 * provider-agnostic code that names a specific network is itself the first
 * step of provider knowledge escaping its folder — the explanation arrives
 * before the `if`, and once the explanation is there the `if` reads as
 * reasonable. Keeping the check textual also keeps it simple enough to trust
 * (P6): there is no comment stripper here to get subtly wrong.
 */

const SRC = resolveSourceRoot();
const ADAPTERS_DIR = join('modules', 'providers', 'adapters');
const REGISTRY_DIR = join('modules', 'providers', 'registry');

describe('provider independence (P1)', () => {
  const sourceFiles = collectTypeScriptFiles(SRC);

  it('finds the source tree it is supposed to be checking', () => {
    // A test that silently scans zero files passes forever. This is the guard
    // that makes every assertion below mean something.
    expect(sourceFiles.length).toBeGreaterThan(30);
    expect(sourceFiles.some((file) => file.relativePath.includes(ADAPTERS_DIR))).toBe(true);
  });

  describe('rule 6 — only the registry knows concrete adapters exist', () => {
    it('has no import of adapters/ from outside modules/providers/registry', () => {
      const offenders = sourceFiles
        .filter((file) => !file.relativePath.startsWith(REGISTRY_DIR))
        .filter((file) => !file.relativePath.startsWith(ADAPTERS_DIR))
        .filter((file) => importsFrom(file.contents, /providers\/adapters\/|\.\.\/adapters\//))
        .map((file) => file.relativePath);

      /*
       * The moment this fails, P1 is over — not gradually, immediately. A
       * single `import { AdGemAdapter }` in the offers module means the
       * catalog sync now depends on one network, and the next one is added by
       * copying that line.
       */
      expect(offenders).toEqual([]);
    });

    it('resolves adapters only through the map', () => {
      const map = readFileSync(join(SRC, REGISTRY_DIR, 'adapter-map.ts'), 'utf8');

      // One line per provider, greppable, and failing at compile time when a
      // slug has no adapter — as opposed to auto-discovery, which fails at
      // runtime, in production, on boot (§7.3).
      for (const slug of Object.keys(PROVIDER_ADAPTERS)) {
        expect(map).toContain(`${slug}:`);
      }
    });
  });

  describe('rule 7 — a provider name appears only inside its own folder', () => {
    it.each(Object.keys(PROVIDER_ADAPTERS))(
      'confines "%s" to its adapter folder and the registry map',
      (slug) => {
        const pattern = new RegExp(`\\b${escapeRegExp(slug)}\\b`, 'i');

        const offenders = sourceFiles
          .filter((file) => !file.relativePath.startsWith(join(ADAPTERS_DIR, slug)))
          .filter((file) => file.relativePath !== join(REGISTRY_DIR, 'adapter-map.ts'))
          // Tests name providers freely — that is how they exercise them.
          .filter((file) => !file.relativePath.endsWith('.spec.ts'))
          .filter((file) => pattern.test(file.contents))
          .map((file) => file.relativePath);

        /*
         * The practical test for P1, stated in §5 rule 7: grep the codebase
         * for a provider name and every hit should be inside that provider's
         * folder, its configuration row, or a fixture.
         *
         * `if (provider === 'adgem')` in core is the failure this catches,
         * and it never arrives as a deliberate decision — it arrives as a
         * one-line workaround for a provider that does something slightly
         * differently, and then it is load-bearing.
         */
        expect(offenders).toEqual([]);
      },
    );
  });

  describe('rule 2 — an adapter imports shared and the provider contracts only', () => {
    it('has no adapter reaching into core, another module, or the registry', () => {
      const offenders: string[] = [];

      for (const file of sourceFiles.filter((f) => f.relativePath.startsWith(ADAPTERS_DIR))) {
        for (const specifier of importSpecifiers(file.contents)) {
          const isInternal = specifier.startsWith('.');
          if (!isInternal) continue;

          // Permitted: the contracts folder, and files within the adapter's
          // own folder. Everything else — core, a sibling module, even the
          // registry — is a stateless translator growing dependencies.
          const permitted =
            specifier.includes('../../contracts/') || specifier.startsWith('./');

          if (!permitted) offenders.push(`${file.relativePath} → ${specifier}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it('has no adapter reading process.env', () => {
      const offenders = sourceFiles
        .filter((file) => file.relativePath.startsWith(ADAPTERS_DIR))
        .filter((file) => !file.relativePath.endsWith('.spec.ts'))
        .filter((file) => /process\.env/.test(file.contents))
        .map((file) => file.relativePath);

      // §7.2 rule 3. Credentials are injected by the registry; an adapter
      // that read its own would duplicate the handling per provider and
      // audit it nowhere.
      expect(offenders).toEqual([]);
    });
  });

  describe('§7.4 — every registered provider ships the whole checklist', () => {
    it.each(Object.keys(PROVIDER_ADAPTERS))('has fixtures and contract tests for "%s"', (slug) => {
      const folder = join(SRC, ADAPTERS_DIR, slug);
      const files = collectTypeScriptFiles(folder).map((f) => f.relativePath);

      expect(readdirSync(join(folder, 'fixtures')).length).toBeGreaterThan(0);
      // Fixtures with no test running against them catch no drift at all.
      expect(files.some((file) => file.endsWith('.spec.ts'))).toBe(true);
    });
  });
});

// --- helpers --------------------------------------------------------------

interface SourceFile {
  relativePath: string;
  contents: string;
}

/**
 * Locates `apps/api/src`, tolerating both invocations: `pnpm test` from the
 * repository root and a filtered run from inside `apps/api`.
 *
 * It **throws** when it cannot find the tree rather than returning a
 * plausible-looking path, because a scanner pointed at an empty directory
 * reports that every rule holds. That is the same failure mode as a boundary
 * rule with a broken resolver — a check whose entire job is to fail, quietly
 * passing.
 *
 * (`import.meta.dirname` would be the obvious way to do this and does not
 * compile: the package targets CommonJS, where `import.meta` is not
 * available. It runs fine under Vitest's transform and fails `tsc`, which is
 * exactly why `verify` runs both.)
 */
function resolveSourceRoot(): string {
  const candidates = [
    join(process.cwd(), 'src'),
    join(process.cwd(), 'apps', 'api', 'src'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'modules', 'providers'))) return candidate;
  }

  throw new Error(
    `Could not locate apps/api/src from ${process.cwd()} — the architecture scan would have checked nothing`,
  );
}

function collectTypeScriptFiles(root: string): SourceFile[] {
  const found: SourceFile[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);

      if (statSync(full).isDirectory()) {
        // Machine-written; linting or grepping it produces findings nobody
        // can act on.
        if (entry === 'generated' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }

      if (!entry.endsWith('.ts')) continue;

      found.push({
        relativePath: relative(SRC, full).split('/').join(sep),
        contents: readFileSync(full, 'utf8'),
      });
    }
  };

  walk(root);
  return found;
}

function importSpecifiers(contents: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }

  return specifiers;
}

function importsFrom(contents: string, pattern: RegExp): boolean {
  return importSpecifiers(contents).some((specifier) => pattern.test(specifier));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
