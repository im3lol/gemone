import {
  OFFER_CATEGORIES,
  WALL_OFFER_SORTS,
  type ListWallOffersQuery,
  type OfferCategory,
  type WallOfferSort,
} from '@gemone/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The wall's query string — PROJECT.md §3.2, milestone M2.
 *
 * Everything is optional: the bare `GET /offers` is the wall, and every
 * parameter narrows it. The bounds exist because this is the platform's most
 * public authenticated read and the one a bored client will fuzz.
 */
export class ListWallOffersDto implements ListWallOffersQuery {
  @IsOptional()
  @IsEnum(OFFER_CATEGORIES)
  category?: OfferCategory;

  /**
   * Bounded and trimmed. An unbounded `contains` is a table scan a client
   * chooses the cost of, and a blank string after trimming would add a
   * predicate matching everything.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minRewardPoints?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxRewardPoints?: number;

  /**
   * ISO-3166 alpha-2, matched against what the provider declared.
   *
   * Validated for *shape* only. A country we have never seen is a legitimate
   * empty result, not a 422 — the set of countries a provider targets is the
   * provider's business and changes without telling us.
   */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/, { message: 'must be an ISO-3166 alpha-2 country code' })
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  device?: string;

  @IsOptional()
  @IsEnum(WALL_OFFER_SORTS)
  sort?: WallOfferSort;

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
