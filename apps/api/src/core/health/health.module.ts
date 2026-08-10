import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health lives in `core` because it is infrastructure with an HTTP surface,
 * not a business domain.
 *
 * Note: ARCHITECTURE.md §3's `core/` listing does not name `health/`. This is
 * an addition to that list, not a departure from it — the section enumerates
 * what was known at design time, and health is unambiguously infrastructure.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
