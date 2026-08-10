import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { AdminListClicksQuery } from '@gemone/contracts';

export class AdminListClicksDto implements AdminListClicksQuery {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  /** Not a UUID — a sub_id is an opaque signed token, looked up verbatim. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  subId?: string;

  /** The query an investigation starts from: "who else clicked from here?" */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string;

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
