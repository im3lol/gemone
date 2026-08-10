import { Injectable, type OnModuleInit } from '@nestjs/common';

import { HealthService } from '../health/health.service';
import type { ReadinessCheck } from '../health/readiness-check';
import { PrismaService } from './prisma.service';

/**
 * Reports the database to `/health/ready` — ARCHITECTURE.md §17.2.
 *
 * This is the first implementation of the readiness contract, and the reason
 * the contract exists: the database registers itself with health, so health
 * never learns what a database is.
 *
 * It deliberately does NOT feed `/health` (liveness). A process whose database
 * has gone away should stop receiving traffic, not be killed and restarted —
 * restarting does not bring the database back, and a restart loop during a
 * database blip makes the outage worse.
 */
@Injectable()
export class DatabaseReadinessCheck implements ReadinessCheck, OnModuleInit {
  readonly name = 'postgres';

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  onModuleInit(): void {
    this.health.register(this);
  }

  /**
   * Never throws — `HealthService` treats a throwing check as not-ready, but
   * a probe endpoint is the wrong place to rely on that. `ping()` already
   * absorbs failures and returns false.
   */
  async isReady(): Promise<boolean> {
    return this.prisma.ping();
  }
}
