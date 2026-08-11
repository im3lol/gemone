import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { Paginated, PayoutOptions, PayoutSummary } from '@gemone/contracts';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { CreatePayoutDto, ListPayoutsDto } from './dto/payouts.dto';
import { PayoutsService } from './payouts.service';

/**
 * The user's withdrawal surface — ARCHITECTURE.md §4 ("authenticated").
 *
 * Three endpoints and no more: learn the rules, ask for money, and see what
 * happened to the asking. Cancelling is deliberately absent — a request an
 * admin may already be part-way through paying is not the user's to withdraw,
 * and "I cancelled but you paid anyway" is a dispute with no good answer.
 *
 * The global `JwtAuthGuard` re-reads the user's status on every request (§8.3),
 * so a suspended account cannot submit a withdrawal in the window between being
 * suspended and its token expiring — which on a platform holding withdrawable
 * balances is exactly the window fraud is cashed out in.
 */
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  /**
   * The configured rules of the form — methods, limits, and the rate.
   *
   * Authenticated rather than public, though nothing here is personal: the
   * platform's economics are not something an anonymous caller needs, and
   * every surface that renders them is behind a session anyway.
   *
   * Declared before `list` only for readability; `/payouts/options` and
   * `/payouts` are distinct paths and neither shadows the other.
   */
  @Get('options')
  async options(): Promise<PayoutOptions> {
    return this.payouts.options();
  }

  /**
   * Requests a withdrawal.
   *
   * The points are locked before this returns (§11.2). If it returns an error,
   * nothing was locked — the lock and the request are one transaction, so
   * there is no state where a user's points are reserved for a request that
   * does not exist.
   */
  @Post()
  async submit(
    @Body() dto: CreatePayoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PayoutSummary> {
    return this.payouts.submit({
      userId: user.id,
      amountPoints: dto.amountPoints,
      method: dto.method,
      destination: dto.destination,
    });
  }

  /**
   * The caller's own withdrawals, and every status transition they went
   * through (PROJECT.md §4.6, step 7).
   *
   * Scoped to the authenticated user inside the service, not by a query
   * parameter — resource ownership is the service's job (§6.2), and an
   * ownership check a caller supplies is one they can change.
   */
  @Get()
  async list(
    @Query() query: ListPayoutsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<PayoutSummary>> {
    const page = await this.payouts.findManyForUser(user.id, query);

    return { ...page, items: page.items.map((payout) => this.payouts.toSummary(payout)) };
  }
}
