import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  USER_ROLES,
  type OfferSummary,
  type Paginated,
  type SyncMode,
  type SyncRunSummary,
} from '@gemone/contracts';
import type { Request } from 'express';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AdminCatalogService } from './admin-catalog.service';
import type { AdminActionContext } from './admin-users.service';
import {
  ListOffersDto,
  ListSyncRunsDto,
  SetOfferActiveDto,
  TriggerSyncDto,
} from './dto/catalog.dto';

/**
 * The catalog administration surface — ARCHITECTURE.md §4.3, §19.1.
 *
 * `@Roles(ADMIN)` on the CONTROLLER, for the reason it is on the other two: a
 * per-handler declaration is one somebody forgets on the next endpoint, and a
 * forgotten check here is an unauthenticated caller able to deactivate the
 * catalog or spend a provider's API quota.
 *
 * There is deliberately **no delete endpoint** for an offer. Clicks will
 * reference offers, and a click whose offer row vanished is an unanswerable
 * support ticket (DATABASE.md §7.2) — removal is `isActive = false`.
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('offers')
  async listOffers(@Query() query: ListOffersDto): Promise<Paginated<OfferSummary>> {
    return this.catalog.listOffers(query);
  }

  /**
   * Declared before `offers/:id` — Nest matches in declaration order, and the
   * other way round `/offers/sync-runs` would be parsed as an offer id.
   */
  @Get('sync-runs')
  async listSyncRuns(@Query() query: ListSyncRunsDto): Promise<Paginated<SyncRunSummary>> {
    return this.catalog.listSyncRuns(query);
  }

  @Get('offers/:id')
  async getOffer(@Param('id', createUuidPipe()) id: string): Promise<OfferSummary> {
    return this.catalog.getOffer(id);
  }

  @Patch('offers/:id/active')
  async setOfferActive(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: SetOfferActiveDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<OfferSummary> {
    return this.catalog.setOfferActive(id, dto.active, dto.reason, contextOf(admin, request));
  }

  /** Enqueues; it does not run the sync inline. See the service for why. */
  @Post('providers/:id/sync')
  async requestSync(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: TriggerSyncDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<{ enqueued: true; providerId: string; mode: SyncMode }> {
    return this.catalog.requestSync(id, dto.mode, null, contextOf(admin, request));
  }
}

function contextOf(admin: AuthenticatedUser, request: Request): AdminActionContext {
  return { adminId: admin.id, ip: request.ip ?? null };
}
