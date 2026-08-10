import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@gemone/contracts';
import type { Response } from 'express';

import { Public } from '../security/public.decorator';
import { HealthService } from './health.service';

/**
 * Health endpoints — ARCHITECTURE.md §17.2.
 *
 * Responses carry status only: no version, no dependency names, no error
 * text. These sit on a public port, and the diagnostic detail belongs in the
 * logs where it is already being written.
 *
 * Unauthenticated by necessity: Docker's health check and the uptime monitor
 * hold no credentials. Authentication is global (§6.2), so opting out is
 * explicit and visible in review — which is the point of opt-out over opt-in.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Consumed by the Docker health check and the uptime monitor. */
  @Get()
  @HttpCode(200)
  liveness(): LivenessResponse {
    this.health.isAlive();
    return { status: 'ok' };
  }

  /**
   * Consumed by the deploy gate (§20.2) and traffic routing.
   *
   * Returns 503 when not ready, because that is what a load balancer and the
   * deploy script act on — a 200 with a "not_ready" body would need every
   * consumer to parse the body to notice.
   */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const ready = await this.health.isReady();
    res.status(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready' };
  }
}
