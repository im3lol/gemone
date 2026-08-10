import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  USER_ROLES,
  type ProviderCapabilityReport,
  type ProviderSummary,
} from '@gemone/contracts';
import type { Request } from 'express';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AdminProvidersService } from './admin-providers.service';
import type { AdminActionContext } from './admin-users.service';
import {
  CreateProviderDto,
  ListProvidersDto,
  ResetProviderHealthDto,
  SetProviderEnabledDto,
  UpdateProviderDto,
} from './dto/provider.dto';

/**
 * The provider administration surface — ARCHITECTURE.md §4.3, §19.1.
 *
 * A second controller rather than more routes on `AdminController`, because
 * they are genuinely separate screens with separate services; sharing one
 * class would make it the place every future admin surface accumulates.
 *
 * `@Roles(ADMIN)` sits on the CONTROLLER, for the same reason it does there:
 * a per-handler declaration is one someone can forget on the next endpoint,
 * and a forgotten role check on a route that can disable a provider is an
 * unauthorised shutdown of the platform's revenue.
 *
 * There is deliberately **no delete endpoint**. A provider row is referenced
 * by every conversion ever received through it (DATABASE.md §7.2), so
 * "removal" is `isEnabled = false` — which keeps the history readable instead
 * of leaving conversions pointing at nothing.
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  @Get()
  async list(@Query() query: ListProvidersDto): Promise<{ items: ProviderSummary[] }> {
    return this.providers.list(query);
  }

  /**
   * What this build can support, independent of what is configured.
   *
   * Declared before `:id` because Nest matches routes in declaration order —
   * the other way round, `/admin/providers/adapters` would be parsed as a
   * provider id and rejected as a malformed UUID.
   */
  @Get('adapters')
  describeAdapters(): { items: ProviderCapabilityReport[] } {
    return this.providers.describeAdapters();
  }

  @Get(':id')
  async get(@Param('id', createUuidPipe()) id: string): Promise<ProviderSummary> {
    return this.providers.get(id);
  }

  @Post()
  async create(
    @Body() dto: CreateProviderDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProviderSummary> {
    return this.providers.create(dto, contextOf(admin, request));
  }

  @Patch(':id')
  async update(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: UpdateProviderDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProviderSummary> {
    return this.providers.update(id, dto, contextOf(admin, request));
  }

  @Patch(':id/enabled')
  async setEnabled(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: SetProviderEnabledDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProviderSummary> {
    return this.providers.setEnabled(id, dto.enabled, dto.reason, contextOf(admin, request));
  }

  @Post(':id/health/reset')
  async resetHealth(
    @Param('id', createUuidPipe()) id: string,
    @Body() dto: ResetProviderHealthDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ProviderSummary> {
    return this.providers.resetHealth(id, dto.reason, contextOf(admin, request));
  }
}

function contextOf(admin: AuthenticatedUser, request: Request): AdminActionContext {
  return { adminId: admin.id, ip: request.ip ?? null };
}
