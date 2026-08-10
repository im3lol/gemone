import { Global, Module } from '@nestjs/common';

import { HealthModule } from '../health/health.module';
import { DatabaseReadinessCheck } from './database-readiness.check';
import { PrismaService } from './prisma.service';

/**
 * Database access — ARCHITECTURE.md §3, `core/database`.
 *
 * Global because nearly every business module will need the client, and
 * threading it through imports would add ceremony without adding a boundary.
 * The boundary that matters is not "who may inject PrismaService" — it is
 * "which tables may a module touch" (DATABASE.md §11), enforced by review and
 * by the architecture test that will guard the reward tables, not by DI
 * visibility.
 *
 * Imports HealthModule so the readiness check can register itself. The arrow
 * points this way on purpose: `core/health` must not know what a database is.
 */
@Global()
@Module({
  imports: [HealthModule],
  providers: [PrismaService, DatabaseReadinessCheck],
  exports: [PrismaService],
})
export class DatabaseModule {}
