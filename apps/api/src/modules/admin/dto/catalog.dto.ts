import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  OFFER_CATEGORIES,
  SYNC_MODES,
  SYNC_OUTCOMES,
  type OfferCategory,
  type SetOfferActiveRequest,
  type SyncMode,
  type SyncOutcome,
  type TriggerSyncRequest,
} from '@gemone/contracts';

const CATEGORIES = Object.values(OFFER_CATEGORIES);
const MODES = Object.values(SYNC_MODES);
const OUTCOMES = Object.values(SYNC_OUTCOMES);

/** Query parameters arrive as strings; the global pipe has implicit conversion off. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListOffersDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: OfferCategory;

  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'must be an ISO-3166 alpha-2 code' })
  country?: string;

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

/**
 * Switching an offer off requires a reason, on the same grounds as every other
 * administrative action: an offer that vanished with no explanation becomes a
 * support ticket nobody can answer.
 */
export class SetOfferActiveDto implements SetOfferActiveRequest {
  @IsBoolean()
  active!: boolean;

  @IsString()
  @MinLength(8, { message: 'must explain the change in at least 8 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class ListSyncRunsDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: SyncOutcome;

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

export class TriggerSyncDto implements TriggerSyncRequest {
  @IsIn(MODES, { message: `must be one of: ${MODES.join(', ')}` })
  mode!: SyncMode;
}
