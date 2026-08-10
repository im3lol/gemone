import {
  MANDATORY_PROVIDER_CAPABILITIES,
  POSTBACK_SIGNING_SCHEMES,
  PROVIDER_CAPABILITIES,
  type ProviderCapability,
} from '@gemone/contracts';

import type {
  OfferProviderAdapter,
  ProviderAdapterMetadata,
} from '../contracts/provider-adapter';
import { isValidIpRange, isValidProviderSlug } from '../internal/ip-range';

/**
 * Adapter validation — the second of two layers.
 *
 * The first layer validates a *row* an admin submitted (ProvidersService).
 * This one validates the *code*: that an adapter's declaration matches what
 * it actually implements, and that it is coherent enough to be trusted with a
 * public postback endpoint.
 *
 * It runs at registration, before an adapter is put into service. The reason
 * that timing matters: every problem detected here is one that would
 * otherwise surface during a sync or a postback — as "all postbacks from this
 * provider are forged", or "the catalog is empty" — hours after deploy and
 * with nothing pointing at the actual cause.
 *
 * Returns problems rather than throwing. A single broken adapter makes *that
 * provider* inert with a readable reason; it does not stop the process from
 * serving the other providers, the wall, or anyone's withdrawal.
 */
export interface AdapterValidationResult {
  valid: boolean;
  problems: string[];
}

const KNOWN_CAPABILITIES = new Set<string>(Object.values(PROVIDER_CAPABILITIES));
const KNOWN_SIGNING_SCHEMES = new Set<string>(Object.values(POSTBACK_SIGNING_SCHEMES));

/** Checked before construction — the registry needs metadata to resolve credentials. */
export function validateAdapterMetadata(
  registeredSlug: string,
  metadata: ProviderAdapterMetadata,
): AdapterValidationResult {
  const problems: string[] = [];

  if (metadata.slug !== registeredSlug) {
    /*
     * The failure this prevents is genuinely nasty: a lookup by slug returns
     * an adapter that signs with a different provider's scheme, so every
     * postback verifies as forged while the catalog syncs perfectly. It looks
     * like the provider changed their secret.
     */
    problems.push(
      `metadata slug "${metadata.slug}" does not match the registered slug "${registeredSlug}"`,
    );
  }

  if (!isValidProviderSlug(metadata.slug)) {
    problems.push(
      `slug "${metadata.slug}" must be 2-32 lowercase alphanumerics separated by single hyphens`,
    );
  }

  if (metadata.displayName.trim().length === 0) {
    problems.push('displayName must not be empty');
  }

  if (!KNOWN_SIGNING_SCHEMES.has(metadata.postbackSigningScheme)) {
    problems.push(`unknown postback signing scheme "${metadata.postbackSigningScheme}"`);
  }

  problems.push(...validateCapabilityDeclaration(metadata.capabilities));

  for (const range of metadata.publishedIpRanges) {
    if (!isValidIpRange(range)) {
      problems.push(`published IP range "${range}" is not a valid address or CIDR block`);
    }
  }

  if (
    metadata.postbackSigningScheme === POSTBACK_SIGNING_SCHEMES.IP_ALLOWLIST &&
    metadata.publishedIpRanges.length === 0
  ) {
    // A provider whose only assurance is its source address, with no
    // addresses declared, verifies nothing at all — every postback would be
    // accepted, from anyone, forever.
    problems.push(
      'ip_allowlist signing requires at least one published IP range, otherwise nothing is verified',
    );
  }

  for (const credential of metadata.requiredCredentials) {
    if (!/^[a-z][a-z0-9_]*$/.test(credential)) {
      problems.push(
        `credential name "${credential}" must be lower snake_case — it becomes part of an environment variable name`,
      );
    }
  }

  return { valid: problems.length === 0, problems };
}

/** Checked after construction — a declaration is only worth what it implements. */
export function validateAdapterImplementation(
  adapter: OfferProviderAdapter,
): AdapterValidationResult {
  const problems: string[] = [];

  const implementations: Record<string, unknown> = {
    [PROVIDER_CAPABILITIES.FETCH_OFFERS]: adapter.fetchOffers,
    [PROVIDER_CAPABILITIES.BUILD_CLICK_URL]: adapter.buildClickUrl,
    [PROVIDER_CAPABILITIES.VERIFY_POSTBACK]: adapter.verifyPostback,
    [PROVIDER_CAPABILITIES.PARSE_POSTBACK]: adapter.parsePostback,
  };

  for (const capability of MANDATORY_PROVIDER_CAPABILITIES) {
    if (typeof implementations[capability] !== 'function') {
      // Unreachable through TypeScript, reachable through a hand-written
      // object literal or a partially stubbed adapter in a test that then
      // gets copied. Cheap to check, and the failure it prevents happens in
      // production during a sync.
      problems.push(`capability "${capability}" is declared but not implemented`);
    }
  }

  return { valid: problems.length === 0, problems };
}

function validateCapabilityDeclaration(
  capabilities: readonly ProviderCapability[],
): string[] {
  const problems: string[] = [];
  const declared = new Set<string>();

  for (const capability of capabilities) {
    if (!KNOWN_CAPABILITIES.has(capability)) {
      problems.push(`unknown capability "${capability}"`);
    }
    if (declared.has(capability)) {
      problems.push(`capability "${capability}" is declared more than once`);
    }
    declared.add(capability);
  }

  for (const mandatory of MANDATORY_PROVIDER_CAPABILITIES) {
    if (!declared.has(mandatory)) {
      problems.push(`mandatory capability "${mandatory}" is not declared`);
    }
  }

  return problems;
}
