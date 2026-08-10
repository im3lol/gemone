import { Controller, Get, Param, Query } from '@nestjs/common';
import type { Paginated, WallOffer } from '@gemone/contracts';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import { ListWallOffersDto } from './dto/wall.dto';
import { OfferWallService } from './offer-wall.service';

/**
 * The offer wall — PROJECT.md §3.2, milestone M2.
 *
 * *"Browse an aggregated offer wall."* One catalog assembled from several
 * provider catalogs, with nothing in the response that could tell a client
 * which network an offer came from beyond its slug, and nothing about what that
 * network pays us.
 *
 * **Authenticated, not public.** The global `JwtAuthGuard` applies because this
 * controller does not opt out with `@Public()`, and that is deliberate rather
 * than incidental: a click needs a user, the per-user click limits are keyed on
 * one, and an anonymous wall would be a free, uncredited copy of every
 * provider's catalog for anyone who found the URL.
 *
 * No `@Roles` — every authenticated user sees the same wall. Which offers a
 * *particular* user may complete is the provider's decision at conversion time
 * (TODO T17), not ours at browse time.
 */
@Controller('offers')
export class OffersController {
  constructor(private readonly wall: OfferWallService) {}

  /** The wall itself: live offers from providers a click would be accepted for. */
  @Get()
  async list(@Query() query: ListWallOffersDto): Promise<Paginated<WallOffer>> {
    return this.wall.list(query);
  }

  /**
   * One offer in full.
   *
   * The uuid pipe answers 422 rather than the framework's 400, so a malformed
   * id and a malformed query parameter are one thing for a client to learn
   * (§15.1). A well-formed id that is not on the wall is a 404.
   */
  @Get(':id')
  async detail(@Param('id', createUuidPipe()) id: string): Promise<WallOffer> {
    return this.wall.detail(id);
  }
}
