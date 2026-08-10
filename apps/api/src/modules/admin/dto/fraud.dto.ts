import {
  FRAUD_ACTIONS,
  FRAUD_REVIEW_DECISIONS,
  type FraudAction,
  type FraudReviewDecision,
  type ReviewHeldConversionRequest,
} from '@gemone/contracts';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminListHeldConversionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  userId?: string;

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

export class AdminListEvaluationsDto extends AdminListHeldConversionsDto {
  /** `HOLD`, `REVIEW` and `BLOCK` are the ones worth listing. */
  @IsOptional()
  @IsEnum(FRAUD_ACTIONS)
  action?: FraudAction;
}

export class ReviewHeldConversionDto implements ReviewHeldConversionRequest {
  @IsEnum(FRAUD_REVIEW_DECISIONS)
  decision!: FraudReviewDecision;

  /**
   * Mandatory, unlike a payout approval's.
   *
   * Both outcomes here are consequential — one releases money the engine
   * suspected, the other takes back money a user was told they had earned —
   * and both are the kind of decision that gets questioned weeks later.
   * Neither is the "expected outcome that needs no defence" that made a
   * payout approval's reason optional.
   */
  @IsString()
  @MaxLength(500)
  reason!: string;
}
