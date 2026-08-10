import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { CreateClickRequest, ListClicksQuery } from '@gemone/contracts';

export class CreateClickDto implements CreateClickRequest {
  @IsUUID(undefined, { message: 'must be a valid offer id' })
  offerId!: string;

  /**
   * The only client-supplied field on this endpoint, and it is deliberately
   * inert: it is stored as fraud evidence and no decision is made on it.
   *
   * Bounded anyway. An unbounded string from an untrusted client is a column
   * someone can fill with a megabyte, on the one table that grows fastest.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceFingerprint?: string;
}

export class ListClicksDto implements ListClicksQuery {
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  /**
   * Query parameters arrive as strings, converted explicitly — the global pipe
   * has implicit conversion off, because implicit coercion turns "abc" into
   * NaN silently.
   */
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
