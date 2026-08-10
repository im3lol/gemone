import { Global, Module } from '@nestjs/common';

import { type Env, loadEnv } from './env.schema';

export const ENV = Symbol('ENV');

/**
 * Makes the validated environment injectable.
 *
 * Global because nearly every core service needs it and threading it through
 * module imports would add ceremony without adding a boundary — env is
 * infrastructure, and infrastructure is what `core` is for (§5, rule 2).
 *
 * Note this is NOT the ConfigurationService (P3). That one is database-backed
 * and arrives with its own feature; the two are deliberately separate (§5.1).
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => loadEnv(),
    },
  ],
  exports: [ENV],
})
export class EnvModule {}
