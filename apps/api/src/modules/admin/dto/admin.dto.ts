import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  USER_ROLES,
  USER_STATUSES,
  type UpdateUserStatusRequest,
  type UserRole,
  type UserStatus,
} from '@gemone/contracts';

const STATUSES = Object.values(USER_STATUSES);
const ROLES = Object.values(USER_ROLES);

/**
 * Every administrative action that changes a user's standing requires a
 * reason.
 *
 * Not a formality: "who did this and why" is asked months later, usually
 * about a dispute, and an unexplained status change is unauditable. A minimum
 * length is enforced because "x" satisfies a required field without
 * satisfying the requirement.
 */
export class UpdateUserStatusDto implements UpdateUserStatusRequest {
  @IsIn(STATUSES, { message: `must be one of: ${STATUSES.join(', ')}` })
  status!: UserStatus;

  @IsString()
  @MinLength(8, { message: 'must explain the change in at least 8 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class RevokeSessionsDto {
  @IsString()
  @MinLength(8, { message: 'must explain the change in at least 8 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ListUsersDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: UserStatus;

  @IsOptional()
  @IsIn(ROLES)
  role?: UserRole;

  @IsOptional()
  @IsEmail({}, { message: 'must be a valid email address' })
  email?: string;

  /**
   * Query parameters arrive as strings, so these are explicitly converted.
   * The global pipe has implicit conversion disabled — implicit coercion
   * turns "abc" into NaN silently, which is exactly the kind of quiet wrong
   * answer a paginated admin list should not produce.
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

export class ListAuditLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  adminId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
