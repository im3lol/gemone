import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { PublicThrottleService } from './public-throttle.service';

/**
 * Applies the public-endpoint request ceiling — ARCHITECTURE.md §19.5.
 *
 * A guard rather than a call inside each handler, for the reason the global
 * auth guards give (§6.2): it runs *before* validation, so a flood of malformed
 * bodies is bounded by the same counter as a flood of valid ones, and the
 * controller keeps its one job of parsing and delegating.
 *
 * Applied per route with `@UseGuards`, not globally. Global would also cover
 * `/postback/*`, where the callers are provider servers whose legitimate
 * traffic is exactly what this refuses, and `/health`, which the container
 * runtime polls every ten seconds.
 *
 * Two public auth endpoints are deliberately left out, for different reasons:
 *
 * - `login` already has a control with different semantics (failures,
 *   released on success). Stacking a request ceiling on top would change which
 *   of the two fires without making anything safer.
 * - `refresh` is only ever called by `web`, so every request carries one
 *   address and a per-IP ceiling would bound the whole platform rather than
 *   any abuser. See the handler for what bounds it instead.
 */
@Injectable()
export class PublicThrottleGuard implements CanActivate {
  constructor(private readonly throttle: PublicThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    await this.throttle.reserve(bucketOf(context), request.ip ?? null);

    return true;
  }
}

/**
 * The counter this request belongs to: the handler's own name.
 *
 * **Not the request path.** Express matches routes case-insensitively, so
 * `/auth/REGISTER` reaches the same handler as `/auth/register` — and a
 * path-keyed bucket would hand an attacker an unlimited supply of fresh
 * counters for one endpoint by varying the capitalisation.
 */
function bucketOf(context: ExecutionContext): string {
  return context.getHandler().name;
}
