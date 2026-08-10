import { describe, expect, it } from 'vitest';
import {
  POSTBACK_SIGNING_SCHEMES,
  PROVIDER_CAPABILITIES,
  type ProviderCapability,
} from '@gemone/contracts';

import { DomainError } from '../../../core/errors/app-error';
import type {
  OfferProviderAdapter,
  ProviderAdapterDefinition,
  ProviderAdapterMap,
} from '../contracts/provider-adapter';
import { ProviderCredentialsResolver } from './provider-credentials';
import { ProviderRegistry } from './provider-registry';

/**
 * The registry, exercised with adapters that do not exist in this repository.
 *
 * That is the point. Every test below drives the real registry, the real
 * validation and the real credential resolution against a provider invented
 * in this file — and not one production file mentions it. If adding a
 * provider required a change anywhere but its own folder and one line of the
 * map, these tests could not be written this way.
 */

const NOWHERE = 'nowhere-network';

function buildAdapter(overrides: Partial<OfferProviderAdapter> = {}): OfferProviderAdapter {
  return {
    metadata: {
      slug: NOWHERE,
      displayName: 'Nowhere Network',
      postbackSigningScheme: POSTBACK_SIGNING_SCHEMES.HMAC_SHA256,
      publishedIpRanges: ['198.51.100.0/24'],
      capabilities: [
        PROVIDER_CAPABILITIES.FETCH_OFFERS,
        PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
        PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
        PROVIDER_CAPABILITIES.PARSE_POSTBACK,
      ],
      requiredCredentials: ['api_key'],
    },
    fetchOffers: async () => [],
    buildClickUrl: () => 'https://nowhere.test/click',
    verifyPostback: () => ({ valid: true }),
    parsePostback: () => {
      throw new Error('not exercised here');
    },
    ...overrides,
  };
}

function definition(
  adapter: OfferProviderAdapter = buildAdapter(),
): ProviderAdapterDefinition {
  return { metadata: adapter.metadata, create: () => adapter };
}

function registry(
  map: ProviderAdapterMap,
  env: NodeJS.ProcessEnv = { PROVIDER_NOWHERE_NETWORK_API_KEY: 'k' },
): ProviderRegistry {
  return new ProviderRegistry(map, new ProviderCredentialsResolver(env));
}

const row = {
  id: '0192f0a0-0000-7000-8000-00000000000a',
  slug: NOWHERE,
  displayName: 'Nowhere Network',
  isEnabled: true,
};

describe('ProviderRegistry', () => {
  describe('adding a provider the core has never heard of', () => {
    it('registers, resolves and serves it with no change to any other file', () => {
      const subject = registry({ [NOWHERE]: definition() });

      subject.load([row]);

      // The literal claim of P1: a provider invented in a test file is a
      // first-class provider to the registry.
      expect(subject.find(NOWHERE)).toBeDefined();
      expect(subject.enabled().map((p) => p.slug)).toEqual([NOWHERE]);
      expect(subject.require(NOWHERE).adapter.metadata.displayName).toBe('Nowhere Network');
    });

    it('injects the declared credentials, resolved by exact variable name', () => {
      let received: Record<string, string> | undefined;

      const subject = registry({
        [NOWHERE]: {
          metadata: buildAdapter().metadata,
          create: (context) => {
            received = { ...context.credentials };
            return buildAdapter();
          },
        },
      });

      subject.load([row]);

      // §7.2 rule 3: an adapter never reads process.env. It declares what it
      // needs and is handed it.
      expect(received).toEqual({ api_key: 'k' });
    });

    it('distinguishes it from every other provider without naming it in core', () => {
      const other = buildAdapter({
        metadata: {
          ...buildAdapter().metadata,
          slug: 'elsewhere',
          displayName: 'Elsewhere',
          capabilities: [
            PROVIDER_CAPABILITIES.FETCH_OFFERS,
            PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
            PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
            PROVIDER_CAPABILITIES.PARSE_POSTBACK,
            PROVIDER_CAPABILITIES.REVERSALS,
          ],
          requiredCredentials: [],
        },
      });

      const subject = registry({
        [NOWHERE]: definition(),
        elsewhere: definition(other),
      });

      subject.load([row, { ...row, id: 'x', slug: 'elsewhere', displayName: 'Elsewhere' }]);

      // Capability discovery is what makes `if (slug === ...)` unnecessary,
      // which is the practical test for P1 (§5, rule 7).
      expect(subject.supports('elsewhere', PROVIDER_CAPABILITIES.REVERSALS)).toBe(true);
      expect(subject.supports(NOWHERE, PROVIDER_CAPABILITIES.REVERSALS)).toBe(false);
    });
  });

  describe('enabled state', () => {
    it('excludes a disabled provider from enumeration but keeps it resolvable', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([{ ...row, isEnabled: false }]);

      // §7.3: a disabled provider is inert. It is still *known*, so the admin
      // screen can show it and an operator can turn it back on.
      expect(subject.enabled()).toEqual([]);
      expect(subject.all()).toHaveLength(1);
    });

    it('refuses to hand out a disabled provider, with a distinct code', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([{ ...row, isEnabled: false }]);

      expect(() => subject.require(NOWHERE)).toThrow(DomainError);
      try {
        subject.require(NOWHERE);
      } catch (error) {
        // Distinct from "not found": one is an operator's decision, the other
        // is a bug in the caller, and collapsing them means reading logs to
        // tell a typo from a deliberate shutdown.
        expect((error as DomainError).code).toBe('PROVIDER_DISABLED');
      }
    });

    it('never filters on health — that would be a state with no exit', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([row]);

      // Health is deliberately absent from the registry's inputs. If an
      // unhealthy provider were excluded here, nothing would call it, so
      // nothing would ever record a success, and it could never recover.
      expect(subject.enabled()).toHaveLength(1);
    });
  });

  describe('registration failures make a provider inert, not the process dead', () => {
    it('reports a row whose slug has no adapter and keeps the others working', () => {
      const subject = registry({ [NOWHERE]: definition() });

      subject.load([row, { ...row, id: 'y', slug: 'deleted-network' }]);

      expect(subject.failures().map((f) => f.slug)).toEqual(['deleted-network']);
      // A deleted adapter must not take down logins, withdrawals, and every
      // other provider with it.
      expect(subject.enabled().map((p) => p.slug)).toEqual([NOWHERE]);
    });

    it('names the missing environment variables rather than saying "misconfigured"', () => {
      const subject = registry({ [NOWHERE]: definition() }, {});

      subject.load([row]);

      const [failure] = subject.failures();
      // "Provider misconfigured" costs someone an hour; this costs a minute.
      expect(failure!.error).toContain('PROVIDER_NOWHERE_NETWORK_API_KEY');
      expect(subject.find(NOWHERE)).toBeUndefined();
    });

    it('treats a blank credential as missing', () => {
      const subject = registry(
        { [NOWHERE]: definition() },
        { PROVIDER_NOWHERE_NETWORK_API_KEY: '   ' },
      );

      subject.load([row]);

      // A blank secret is the shape a half-finished deployment takes. Treating
      // it as present means the provider registers and then fails every
      // signature check instead of reporting the actual problem.
      expect(subject.failures()).toHaveLength(1);
    });

    it('rejects an adapter whose metadata slug disagrees with its registration', () => {
      const subject = registry({
        // Registered as `nowhere-network`, declares itself `something-else`.
        [NOWHERE]: definition(
          buildAdapter({
            metadata: { ...buildAdapter().metadata, slug: 'something-else' },
          }),
        ),
      });

      subject.load([row]);

      // The failure this prevents: lookups by slug return an adapter that
      // signs with a different provider's scheme, so every postback verifies
      // as forged while the catalog syncs perfectly.
      expect(subject.failures()[0]!.error).toContain('does not match');
    });

    it('survives an adapter whose construction throws', () => {
      const subject = registry({
        [NOWHERE]: {
          metadata: buildAdapter().metadata,
          create: () => {
            throw new Error('boom');
          },
        },
      });

      expect(() => subject.load([row])).not.toThrow();
      expect(subject.failures()[0]!.error).toContain('boom');
    });

    it('rejects an adapter that declares a capability it did not implement', () => {
      const broken = buildAdapter();
      // Reachable through a hand-written object literal or a partially stubbed
      // adapter — and the failure would otherwise happen in production during
      // a sync.
      (broken as { parsePostback?: unknown }).parsePostback = undefined;

      const subject = registry({ [NOWHERE]: definition(broken) });
      subject.load([row]);

      expect(subject.failures()[0]!.error).toContain('parse_postback');
    });
  });

  describe('lookup', () => {
    it('separates unknown, disabled and unregistrable into distinct codes', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([{ ...row, slug: 'gone' }]);

      const codeOf = (slug: string): string => {
        try {
          subject.require(slug);
          return 'no-error';
        } catch (error) {
          return (error as DomainError).code;
        }
      };

      expect(codeOf('never-existed')).toBe('PROVIDER_NOT_FOUND');
      expect(codeOf('gone')).toBe('PROVIDER_UNKNOWN_SLUG');
    });

    it('answers "no" for a capability on a provider that is not there', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([]);

      // "Can it do X" has a correct answer for a provider that is absent, and
      // it is no. Throwing would make every caller wrap the question.
      expect(subject.supports('anything', PROVIDER_CAPABILITIES.REVERSALS)).toBe(false);
    });

    it('refuses a capability the adapter does not declare', () => {
      const subject = registry({ [NOWHERE]: definition() });
      subject.load([row]);

      expect(() =>
        subject.requireCapability(NOWHERE, PROVIDER_CAPABILITIES.REVERSALS),
      ).toThrow(DomainError);
      expect(() =>
        subject.requireCapability(NOWHERE, PROVIDER_CAPABILITIES.FETCH_OFFERS),
      ).not.toThrow();
    });
  });

  describe('reloading', () => {
    it('replaces the snapshot rather than merging into it', () => {
      const subject = registry({
        [NOWHERE]: definition(),
        elsewhere: definition(
          buildAdapter({
            metadata: {
              ...buildAdapter().metadata,
              slug: 'elsewhere',
              requiredCredentials: [],
            },
          }),
        ),
      });

      subject.load([row, { ...row, id: 'z', slug: 'elsewhere' }]);
      expect(subject.all()).toHaveLength(2);

      subject.load([row]);

      // A merge would leave a deleted provider resolvable forever — which for
      // a provider means still accepting its postbacks.
      expect(subject.all().map((p) => p.slug)).toEqual([NOWHERE]);
    });

    it('distinguishes "not loaded yet" from "no providers"', () => {
      const subject = registry({ [NOWHERE]: definition() });

      expect(subject.isLoaded()).toBe(false);
      subject.load([]);
      expect(subject.isLoaded()).toBe(true);
      expect(subject.all()).toEqual([]);
    });
  });

  describe('capability discovery for the admin panel', () => {
    it('describes every adapter in the build, registered or not', () => {
      const subject = registry({ [NOWHERE]: definition() }, {});
      subject.load([]);

      const [report] = subject.describeAdapters();

      // Answers "what can this deployment support" before any row exists —
      // the question someone adding a provider is actually asking.
      expect(report!.slug).toBe(NOWHERE);
      expect(report!.registered).toBe(false);
      expect(report!.capabilities).toContain(PROVIDER_CAPABILITIES.FETCH_OFFERS);
    });

    it('reports credential variable NAMES and never a value', () => {
      const subject = registry(
        { [NOWHERE]: definition() },
        { PROVIDER_NOWHERE_NETWORK_API_KEY: 'super-secret-value' },
      );
      subject.load([row]);

      const [report] = subject.describeAdapters();

      expect(report!.requiredCredentialVariables).toEqual([
        'PROVIDER_NOWHERE_NETWORK_API_KEY',
      ]);
      // Nobody needs a secret read back to them, at any role level (§19.3).
      expect(JSON.stringify(report)).not.toContain('super-secret-value');
    });

    it('lists the slugs a provider row may name', () => {
      const subject = registry({ [NOWHERE]: definition() });

      expect(subject.knownSlugs()).toEqual([NOWHERE]);
      expect(subject.hasAdapterFor(NOWHERE)).toBe(true);
      expect(subject.hasAdapterFor('typo')).toBe(false);
    });
  });
});

/** Kept honest: the capability type is a closed set, not free-form strings. */
const _capabilityIsClosed: ProviderCapability = PROVIDER_CAPABILITIES.REVERSALS;
void _capabilityIsClosed;
