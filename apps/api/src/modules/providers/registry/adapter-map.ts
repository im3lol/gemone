import { mockProviderDefinition } from '../adapters/mock/mock.adapter';
import type { ProviderAdapterMap } from '../contracts/provider-adapter';

/**
 * **The only file in the codebase that names a concrete adapter** — §5, rule 6.
 *
 * Adding a provider is one line here, and that is step 5 of the seven-step
 * checklist in §7.4. `provider-independence.spec.ts` asserts mechanically
 * that no file outside this folder imports from `adapters/`, and
 * eslint.config.mjs fails the build if one does — so the claim stays true
 * without anyone having to remember it.
 *
 * Explicit rather than auto-discovered, deliberately. Filesystem scanning or
 * decorator registration would be shorter and would move every failure from
 * compile time to boot time in production: a renamed folder becomes "the
 * provider silently stopped existing" instead of "the build did not compile"
 * (P6, §7.3).
 */
export const PROVIDER_ADAPTERS: ProviderAdapterMap = {
  mock: mockProviderDefinition,
};

/**
 * Injection token for the map.
 *
 * The registry takes the map as a dependency rather than importing it, for
 * one reason worth the indirection: it makes "adding a provider changes
 * nothing outside its folder" a *testable* claim. A test supplies a map
 * containing an adapter that has never existed in this repository and drives
 * the registry, the lifecycle, and capability discovery against it — with no
 * production file altered. That test is the honest version of the P1 promise;
 * without this token it could only be argued, not run.
 */
export const PROVIDER_ADAPTER_MAP = Symbol('PROVIDER_ADAPTER_MAP');
