import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  PAYOUT_STATUSES,
  type CreatePayoutRequest,
  type ListPayoutsQuery,
  type PayoutStatus,
} from '@gemone/contracts';

export class CreatePayoutDto implements CreatePayoutRequest {
  /**
   * Bounds here are structural, not the business rule.
   *
   * The configured minimum and maximum (P3) are checked in the service, where
   * they can be read from configuration; this only refuses values that are not
   * a plausible number of points at all, so that a malformed request fails as
   * validation rather than as a business rule an admin thinks they set.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountPoints!: number;

  /**
   * Not an enum: the available methods are configuration, and a `class-validator`
   * enum here would put the list back in code (PROJECT.md §4.6). The service
   * checks it against what an admin has enabled.
   */
  @IsString()
  @MaxLength(32)
  method!: string;

  @IsString()
  @MaxLength(200)
  destination!: string;
}

export class ListPayoutsDto implements ListPayoutsQuery {
  @IsOptional()
  @IsEnum(PAYOUT_STATUSES)
  status?: PayoutStatus;

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
