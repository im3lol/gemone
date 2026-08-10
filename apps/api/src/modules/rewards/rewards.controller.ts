import { Controller, Get, Query } from '@nestjs/common';
import type {
  Balance,
  Paginated,
  RewardTransactionRecord,
} from '@gemone/contracts';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { RewardAccountingService } from './reward-accounting.service';
import { RewardHistoryDto } from './dto/rewards.dto';

/**
 * The user's own balance and statement — ARCHITECTURE.md §4 ("authenticated,
 * read-only").
 *
 * **Read-only, and there is deliberately no write of any kind.** Points move
 * because something happened — a conversion, a chargeback, a withdrawal — and
 * every one of those has its own surface. An endpoint here that changed a
 * balance would be a way to move money with no event behind it, which is
 * precisely what the transaction history exists to make impossible.
 *
 * Scoped to the authenticated caller inside the handler rather than by a
 * parameter: resource ownership is not something a caller supplies (§6.2).
 */
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewards: RewardAccountingService) {}

  /**
   * Three buckets, never one number.
   *
   * A client that showed `total` as "your balance" would tell a user they can
   * withdraw points that are still inside their hold period — which is the
   * single most common way an offerwall creates a support ticket. The shape
   * makes that mistake require effort.
   */
  @Get('balance')
  async balance(@CurrentUser() user: AuthenticatedUser): Promise<Balance> {
    return this.rewards.getBalance(user.id);
  }

  /**
   * The statement.
   *
   * Returned verbatim from the service's record type, including the bucket
   * deltas. They are not internals: "why is this pending" and "where did these
   * points go" are answered by them, and a user who can see the movement can
   * check our arithmetic — which is the correct relationship to have with
   * someone whose money we are holding.
   */
  @Get('history')
  async history(
    @Query() query: RewardHistoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<RewardTransactionRecord>> {
    return this.rewards.getHistory(user.id, query);
  }
}
