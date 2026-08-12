import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  REWARD_STATUSES,
  REWARD_TRANSACTION_TYPES,
  type RewardHistoryQuery,
  type RewardStatus,
  type RewardTransactionType,
} from '@gemone/contracts';

export class RewardHistoryDto implements RewardHistoryQuery {
  @IsOptional()
  @IsEnum(REWARD_TRANSACTION_TYPES)
  type?: RewardTransactionType;

  /**
   * The derived status — TODO T80.
   *
   * Validated against the contract's own set, so an unknown value is a 422
   * naming the allowed ones rather than a silently ignored parameter that
   * returns everything. The client is expected to keep a bad status out of the
   * URL in the first place; this is what makes it a refusal and not a lie.
   */
  @IsOptional()
  @IsEnum(REWARD_STATUSES)
  status?: RewardStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
