import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  REWARD_TRANSACTION_TYPES,
  type RewardHistoryQuery,
  type RewardTransactionType,
} from '@gemone/contracts';

export class RewardHistoryDto implements RewardHistoryQuery {
  @IsOptional()
  @IsEnum(REWARD_TRANSACTION_TYPES)
  type?: RewardTransactionType;

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
