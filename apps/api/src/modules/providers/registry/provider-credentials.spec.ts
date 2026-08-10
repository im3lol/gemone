import { describe, expect, it } from 'vitest';

import { ProviderCredentialsResolver } from './provider-credentials';

describe('ProviderCredentialsResolver', () => {
  describe('variable naming', () => {
    it('derives a variable name from the slug and credential', () => {
      expect(ProviderCredentialsResolver.variableName('mock', 'secret')).toBe(
        'PROVIDER_MOCK_SECRET',
      );
    });

    it('converts hyphens in a slug to underscores', () => {
      // A convention rather than a per-provider mapping table, so adding a
      // provider needs no edit to this file (§7.4).
      expect(ProviderCredentialsResolver.variableName('acme-eu', 'api_key')).toBe(
        'PROVIDER_ACME_EU_API_KEY',
      );
    });
  });

  describe('resolution', () => {
    it('returns exactly the declared credentials', () => {
      const resolver = new ProviderCredentialsResolver({
        PROVIDER_ACME_API_KEY: 'key',
        PROVIDER_ACME_SECRET: 'shh',
      });

      const { credentials, missing } = resolver.resolve('acme', ['api_key', 'secret']);

      expect(credentials).toEqual({ api_key: 'key', secret: 'shh' });
      expect(missing).toEqual([]);
    });

    it('does NOT leak a variable belonging to a slug that shares a prefix', () => {
      const resolver = new ProviderCredentialsResolver({
        PROVIDER_ACME_API_KEY: 'key',
        PROVIDER_ACME_EU_API_KEY: 'europe-only-secret',
      });

      const { credentials } = resolver.resolve('acme', ['api_key']);

      /*
       * The reason resolution is by exact name and not by prefix scan.
       *
       * A prefix scan would hand `acme` the value of PROVIDER_ACME_EU_API_KEY
       * as a credential named `eu_api_key` — one provider receiving another
       * provider's secret, whenever one slug prefixes another.
       */
      expect(credentials).toEqual({ api_key: 'key' });
      expect(Object.values(credentials)).not.toContain('europe-only-secret');
    });

    it('reports missing variables by name', () => {
      const resolver = new ProviderCredentialsResolver({});

      const { missing } = resolver.resolve('acme', ['api_key', 'secret']);

      expect(missing).toEqual(['PROVIDER_ACME_API_KEY', 'PROVIDER_ACME_SECRET']);
    });

    it('treats a blank value as missing', () => {
      const resolver = new ProviderCredentialsResolver({ PROVIDER_ACME_API_KEY: '  ' });

      // A blank secret is what a half-finished deployment looks like.
      // Accepting it produces a provider that registers and then fails every
      // signature check, reporting the wrong problem.
      expect(resolver.resolve('acme', ['api_key']).missing).toEqual([
        'PROVIDER_ACME_API_KEY',
      ]);
    });

    it('asks for nothing when an adapter declares nothing', () => {
      const resolver = new ProviderCredentialsResolver({});

      expect(resolver.resolve('acme', [])).toEqual({ credentials: {}, missing: [] });
    });
  });
});
