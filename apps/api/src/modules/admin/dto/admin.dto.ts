import { Transform, Type } from 'class-transformer';
import {
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

  /**
   * A **fragment** of an email, not an address.
   *
   * `UsersService.findMany` has always matched this with `contains`, and
   * `ListUsersQuery` has always documented it as a substring match — but this
   * field validated it with `@IsEmail`, so the only queries that passed were
   * the complete addresses for which a search box is unnecessary. `?email=p11`
   * was answered with *"must be a valid email address"*, which is a correct
   * sentence about the wrong thing.
   *
   * Bounded rather than unvalidated: the value reaches a `contains`, and a
   * megabyte of it is a query worth refusing before it reaches the database.
   */
  @IsOptional()
  @IsString()
  @MaxLength(320)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
