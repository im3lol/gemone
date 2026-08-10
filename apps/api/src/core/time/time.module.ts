import { Global, Module } from '@nestjs/common';

import { CLOCK, SystemClock } from './clock';

/**
 * Provides the injectable clock.
 *
 * Global because nearly everything that touches expiry, scheduling or
 * maturity needs it, and threading it through module imports would add
 * ceremony without adding a boundary — time is infrastructure.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class TimeModule {}
