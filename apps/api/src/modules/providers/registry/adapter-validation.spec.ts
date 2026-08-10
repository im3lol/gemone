import { describe, expect, it } from 'vitest';
import { POSTBACK_SIGNING_SCHEMES, PROVIDER_CAPABILITIES } from '@gemone/contracts';

import type {
  OfferProviderAdapter,
  ProviderAdapterMetadata,
} from '../contracts/provider-adapter';
import {
  validateAdapterImplementation,
  validateAdapterMetadata,
} from './adapter-validation';

const VALID: ProviderAdapterMetadata = {
  slug: 'acme',
  displayName: 'Acme Network',
  postbackSigningScheme: POSTBACK_SIGNING_SCHEMES.HMAC_SHA256,
  publishedIpRanges: ['198.51.100.0/24'],
  capabilities: [
    PROVIDER_CAPABILITIES.FETCH_OFFERS,
    PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
    PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
    PROVIDER_CAPABILITIES.PARSE_POSTBACK,
  ],
  requiredCredentials: ['api_key'],
};

const problemsOf = (metadata: Partial<ProviderAdapterMetadata>, slug = 'acme'): string =>
  validateAdapterMetadata(slug, { ...VALID, ...metadata } as ProviderAdapterMetadata)
    .problems.join(' | ');

describe('validateAdapterMetadata', () => {
  it('accepts a coherent adapter', () => {
    expect(validateAdapterMetadata('acme', VALID)).toEqual({ valid: true, problems: [] });
  });

  it('rejects a slug that disagrees with the registration key', () => {
    expect(problemsOf({ slug: 'other' })).toContain('does not match');
  });

  it('rejects a malformed slug', () => {
    expect(problemsOf({ slug: 'Acme_Network' }, 'Acme_Network')).toContain('lowercase');
  });

  it('rejects an empty display name', () => {
    expect(problemsOf({ displayName: '   ' })).toContain('displayName');
  });

  it('rejects an unknown signing scheme', () => {
    expect(
      problemsOf({ postbackSigningScheme: 'trust-me' as never }),
    ).toContain('unknown postback signing scheme');
  });

  it('rejects a missing mandatory capability', () => {
    expect(
      problemsOf({
        capabilities: [
          PROVIDER_CAPABILITIES.FETCH_OFFERS,
          PROVIDER_CAPABILITIES.BUILD_CLICK_URL,
          PROVIDER_CAPABILITIES.VERIFY_POSTBACK,
        ],
      }),
    ).toContain('mandatory capability "parse_postback" is not declared');
  });

  it('rejects an unknown or duplicated capability', () => {
    expect(problemsOf({ capabilities: [...VALID.capabilities, 'teleport' as never] })).toContain(
      'unknown capability',
    );
    expect(
      problemsOf({ capabilities: [...VALID.capabilities, PROVIDER_CAPABILITIES.FETCH_OFFERS] }),
    ).toContain('declared more than once');
  });

  it('rejects a malformed published IP range', () => {
    expect(problemsOf({ publishedIpRanges: ['198.51.100.0/99'] })).toContain(
      'not a valid address',
    );
  });

  it('rejects ip_allowlist signing with no ranges to allow', () => {
    /*
     * A provider whose only assurance is its source address, with no
     * addresses declared, verifies nothing at all — every postback would be
     * accepted, from anyone, forever. That is the quietest possible way to
     * lose money, so it is a registration failure rather than a warning.
     */
    expect(
      problemsOf({
        postbackSigningScheme: POSTBACK_SIGNING_SCHEMES.IP_ALLOWLIST,
        publishedIpRanges: [],
      }),
    ).toContain('nothing is verified');
  });

  it('rejects a credential name that cannot become an environment variable', () => {
    expect(problemsOf({ requiredCredentials: ['API-Key'] })).toContain('snake_case');
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = validateAdapterMetadata('acme', {
      ...VALID,
      slug: 'WRONG',
      displayName: '',
      publishedIpRanges: ['nope'],
    });

    // An adapter fixed one error at a time takes as many deploys as it has
    // mistakes.
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateAdapterImplementation', () => {
  const adapter = (overrides: Partial<OfferProviderAdapter> = {}): OfferProviderAdapter =>
    ({
      metadata: VALID,
      fetchOffers: async () => [],
      buildClickUrl: () => '',
      verifyPostback: () => ({ valid: true }),
      parsePostback: () => {
        throw new Error('unused');
      },
      ...overrides,
    }) as OfferProviderAdapter;

  it('accepts an adapter that implements what it declares', () => {
    expect(validateAdapterImplementation(adapter()).valid).toBe(true);
  });

  it('rejects a declared capability with no implementation behind it', () => {
    const result = validateAdapterImplementation(
      adapter({ verifyPostback: undefined as never }),
    );

    // Unreachable through TypeScript, reachable through a hand-written object
    // literal or a partially stubbed adapter that gets copied — and the
    // failure would otherwise land in production, on a postback.
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toContain('verify_postback');
  });
});
