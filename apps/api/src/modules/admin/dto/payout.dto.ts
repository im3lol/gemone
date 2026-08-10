import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  PAYOUT_STATUSES,
  type AdminListPayoutsQuery,
  type PayoutStatus,
  type ReviewPayoutRequest,
  type SettlePayoutRequest,
} from '@gemone/contracts';

export class AdminListPayoutsDto implements AdminListPayoutsQuery {
  /** The queue an admin opens this screen for is `PENDING_REVIEW`. */
  @IsOptional()
  @IsEnum(PAYOUT_STATUSES)
  status?: PayoutStatus;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  method?: string;

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

/**
 * Optional here, and required by the *service* for rejection and failure.
 *
 * The requirement lives with the state machine rather than with the DTO
 * because it depends on which transition is being made, and a DTO that could
 * not express "mandatory for two of three endpoints" would have to be three
 * DTOs that drift.
 */
export class ReviewPayoutDto implements Partial<ReviewPayoutRequest> {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SettlePayoutDto implements SettlePayoutRequest {
  /**
   * Mandatory. "Paid" with nothing to point at is a claim, not a record — and
   * it is the only evidence that exists when a user says they never received
   * anything.
   */
  @IsString()
  @MaxLength(200)
  externalReference!: string;
}
