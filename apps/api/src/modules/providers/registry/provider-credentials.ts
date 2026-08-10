/**
 * Resolves provider credentials from the environment — ARCHITECTURE.md §7.2,
 * rule 3.
 *
 * **The only place provider secrets are read.** An adapter never touches
 * `process.env`; it declares the credentials it needs and receives them. The
 * alternative — each adapter reading its own variables — duplicates the
 * handling per provider and audits it nowhere, so "which secrets does this
 * deployment actually need" becomes a question answered by grepping.
 *
 * Credentials are environment and not configuration (§5.1): they are secrets,
 * they change with a deploy, and a secret in a database row is a secret in
 * every backup, every replica, and the blast radius of any SQL injection
 * (DATABASE.md §1).
 *
 * The source is injected rather than read from the global `process.env` so
 * that the resolution rules are testable without mutating global state — the
 * same reasoning as `Clock`.
 */
export class ProviderCredentialsResolver {
  constructor(private readonly source: NodeJS.ProcessEnv) {}

  /**
   * `PROVIDER_<SLUG>_<CREDENTIAL>`, uppercased, hyphens to underscores.
   *
   * A convention rather than a per-provider mapping table, so adding a
   * provider needs no edit here — which is what "zero changes outside the
   * adapter folder" (§7.4) requires of this file too.
   */
  static variableName(slug: string, credential: string): string {
    return `PROVIDER_${toSegment(slug)}_${toSegment(credential)}`;
  }

  /**
   * Reads exactly the declared credentials. Nothing else.
   *
   * Resolving by exact name rather than by scanning the slug's prefix is a
   * correctness requirement, not tidiness: with a prefix scan, the adapter
   * registered as `acme` would receive every `PROVIDER_ACME_EU_*` variable
   * too, handing one provider another provider's secrets whenever one slug
   * prefixes another.
   */
  resolve(
    slug: string,
    required: readonly string[],
  ): { credentials: Record<string, string>; missing: string[] } {
    const credentials: Record<string, string> = {};
    const missing: string[] = [];

    for (const credential of required) {
      const variable = ProviderCredentialsResolver.variableName(slug, credential);
      const value = this.source[variable];

      // An empty string counts as missing. A blank secret is the shape a
      // half-finished deployment takes, and treating it as present means the
      // provider registers and then fails every signature check instead of
      // reporting the actual problem.
      if (value === undefined || value.trim().length === 0) {
        missing.push(variable);
        continue;
      }

      credentials[credential] = value;
    }

    return { credentials, missing };
  }
}

function toSegment(value: string): string {
  return value.replaceAll('-', '_').toUpperCase();
}
