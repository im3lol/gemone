import { Module } from '@nestjs/common';

import { ProviderHealthService } from './provider-health.service';
import { ProvidersService } from './providers.service';
import { PROVIDER_ADAPTER_MAP, PROVIDER_ADAPTERS } from './registry/adapter-map';
import { ProviderCredentialsResolver } from './registry/provider-credentials';
import { ProviderRegistry } from './registry/provider-registry';

/**
 * Owns the `providers` table and every adapter — ARCHITECTURE.md §4, §7.
 *
 * **No HTTP surface**, by design. §4's module table says so, and §4.3 says
 * why: the administrative screens for providers belong to `admin`, which
 * composes this module's services. A module that grew its own admin
 * controller would end up with two implementations of the same rules, and the
 * admin one is the one that drifts.
 *
 * Exports the registry and both services, because every downstream feature
 * needs them: `offers` enumerates enabled providers to sync, `clicks` resolves
 * an adapter to build a redirect, `conversions` resolves one to verify a
 * postback, and all three report outcomes to health.
 */
@Module({
  providers: [
    {
      /*
       * The adapter map is provided rather than imported.
       *
       * One indirection, for one reason: it makes P1 a claim a test can run.
       * A test supplies a map holding an adapter that has never existed in
       * this repository and drives the registry, the lifecycle and capability
       * discovery against it, with no production file altered. Without the
       * token, "adding a provider changes nothing outside its folder" could
       * only be argued.
       */
      provide: PROVIDER_ADAPTER_MAP,
      useValue: PROVIDER_ADAPTERS,
    },
    {
      /*
       * Provider credentials are environment (§5.1), and this resolver is the
       * only thing in the codebase that reads them. `process.env` is injected
       * here rather than reached for inside the class so the resolution rules
       * stay testable without mutating global state — the same reasoning that
       * put `Clock` behind an interface.
       */
      provide: ProviderCredentialsResolver,
      useFactory: (): ProviderCredentialsResolver =>
        new ProviderCredentialsResolver(process.env),
    },
    ProviderRegistry,
    ProvidersService,
    ProviderHealthService,
  ],
  exports: [ProviderRegistry, ProvidersService, ProviderHealthService],
})
export class ProvidersModule {}
