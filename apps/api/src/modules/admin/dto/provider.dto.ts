import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PROVIDER_HEALTH_STATES,
  type CreateProviderRequest,
  type ProviderHealthState,
  type SetProviderEnabledRequest,
  type UpdateProviderRequest,
} from '@gemone/contracts';

const HEALTH_STATES = Object.values(PROVIDER_HEALTH_STATES);

/**
 * Shape validation only.
 *
 * The rules that make a value *correct* — that a slug has an adapter, that an
 * IP range parses, that a sync interval is sane — live in `ProvidersService`,
 * because they are business rules and the module that owns providers owns
 * them. A DTO that duplicated them would be a second implementation to keep
 * in step, and the two would drift the first time a bound changed (§4.3).
 */
export class CreateProviderDto implements CreateProviderRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  displayName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncIntervalMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  postbackIpRanges?: string[];
}

export class UpdateProviderDto implements UpdateProviderRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  displayName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncIntervalMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  postbackIpRanges?: string[];
}

/**
 * Enabling or disabling a provider requires a reason, on the same grounds as
 * a user status change: it is the change people ask about first, usually
 * weeks later, and "someone turned it off" is not an answer.
 */
export class SetProviderEnabledDto implements SetProviderEnabledRequest {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MinLength(8, { message: 'must explain the change in at least 8 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ResetProviderHealthDto {
  @IsString()
  @MinLength(8, { message: 'must explain the change in at least 8 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ListProvidersDto {
  /**
   * Query parameters arrive as strings. Converted explicitly, because the
   * global pipe has implicit conversion disabled — implicit coercion would
   * turn `?isEnabled=false` into the boolean `true`, which is the kind of
   * quiet wrong answer that hides every disabled provider from the screen
   * built to find them.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsIn(HEALTH_STATES)
  healthState?: ProviderHealthState;
}
