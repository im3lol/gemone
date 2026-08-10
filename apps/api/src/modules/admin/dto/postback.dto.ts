import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { POSTBACK_STATES, type AdminListPostbacksQuery, type PostbackState } from '@gemone/contracts';

export class AdminListPostbacksDto implements AdminListPostbacksQuery {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  /** "Show me the quarantine queue" is the first thing an admin asks here. */
  @IsOptional()
  @IsEnum(POSTBACK_STATES)
  state?: PostbackState;

  /**
   * Not a UUID — it is the provider's own identifier, in the provider's own
   * format, looked up verbatim. It is also the reference a provider quotes in
   * a dispute, which makes it the most common search on this screen.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalTransactionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;

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
