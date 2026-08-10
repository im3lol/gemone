import {
  CONFIG_SCOPES,
  type AdminListConfigurationQuery,
  type ConfigScopeName,
  type ResetConfigurationRequest,
  type SetConfigurationRequest,
} from '@gemone/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminListConfigurationDto implements AdminListConfigurationQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overriddenOnly?: boolean;
}

export class AdminConfigurationDetailDto {
  /**
   * Ask the effective-value question for one provider.
   *
   * A UUID because the only scope below GLOBAL is a provider. Validating it
   * here means a malformed id is a 422 rather than a lookup that finds nothing
   * and reads as "no override set".
   */
  @IsOptional()
  @IsUUID()
  scopeId?: string;
}

export class SetConfigurationDto implements SetConfigurationRequest {
  /**
   * Untyped on the wire, validated on the way in by the key's own schema.
   *
   * `@IsDefined` rather than `@IsNotEmpty`: `false` and `0` are legitimate
   * values for a boolean and a numeric key, and `@IsNotEmpty` would reject
   * both. The only thing this layer can honestly check is that the caller sent
   * the field at all — everything else belongs to the schema registered with
   * the key (§4.9).
   */
  @IsDefined()
  value!: unknown;

  @IsOptional()
  @IsEnum(CONFIG_SCOPES)
  scope?: ConfigScopeName;

  @IsOptional()
  @IsUUID()
  scopeId?: string;

  /**
   * Mandatory, with a floor.
   *
   * A configuration change alters economics with no deployment and no review
   * behind it, and this is the only part of the record a person writes. A
   * minimum length is a blunt instrument against "x", and a blunt instrument
   * is better than nothing on the field that will be read months later.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ResetConfigurationDto implements ResetConfigurationRequest {
  @IsOptional()
  @IsEnum(CONFIG_SCOPES)
  scope?: ConfigScopeName;

  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ConfigurationHistoryQueryDto {
  @IsOptional()
  @IsEnum(CONFIG_SCOPES)
  scope?: ConfigScopeName;

  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
