import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  CONVERSION_STATUSES,
  CONVERSION_TYPES,
  type AdminListConversionsQuery,
  type ConversionStatus,
  type ConversionType,
} from '@gemone/contracts';

export class AdminListConversionsDto implements AdminListConversionsQuery {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  clickId?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  /** The review queue: `HELD` is what an admin opens this screen for. */
  @IsOptional()
  @IsEnum(CONVERSION_STATUSES)
  status?: ConversionStatus;

  @IsOptional()
  @IsEnum(CONVERSION_TYPES)
  type?: ConversionType;

  /**
   * The provider's own reference, in the provider's own format. Not a UUID,
   * and it is what a provider quotes in a dispute.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalTransactionId?: string;

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
