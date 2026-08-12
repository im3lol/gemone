import {
  USER_ROLES,
  type AdminConfigurationKeyDetail,
  type AdminConfigurationKeyList,
  type ConfigurationHistoryEntry,
} from '@gemone/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { AdminConfigurationService } from './admin-configuration.service';
import {
  AdminConfigurationDetailDto,
  AdminListConfigurationDto,
  ConfigurationHistoryQueryDto,
  ResetConfigurationDto,
  SetConfigurationDto,
} from './dto/configuration.dto';

/**
 * Configuration management — P3, PROJECT.md §3.2.
 *
 * *"Adjust reward rates, hold periods, withdrawal limits, daily limits, fraud
 * thresholds, currencies — without a developer."* Every one of those values has
 * been a database row since the feature that introduced it; this is the surface
 * that finally reaches them.
 *
 * ## Why the key is a path parameter and not a body field
 *
 * `PUT /admin/configuration/rewards.hold_period_days` names the thing being
 * changed in the URL, which is what makes the audit log, the access log and the
 * error log agree about what was touched. A single `POST /admin/configuration`
 * carrying the key in the body would put the most important fact of the request
 * in the one place none of those three record.
 *
 * Keys are dotted and lowercase, never user-supplied identifiers — an
 * unregistered key is a 404 before anything is read or written.
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/configuration')
export class AdminConfigurationController {
  constructor(private readonly configuration: AdminConfigurationService) {}

  /** Every registered key with the value in force, searchable. */
  @Get()
  async list(@Query() query: AdminListConfigurationDto): Promise<AdminConfigurationKeyList> {
    return this.configuration.list(query);
  }

  /**
   * One key: its definition, every explicit setting, and its timeline.
   *
   * Pass `scopeId` to ask what a particular provider would resolve to — the
   * effective-value inspection §4.9 requires, rather than leaving an admin to
   * apply the chain by hand.
   */
  @Get(':key')
  async detail(
    @Param('key') key: string,
    @Query() query: AdminConfigurationDetailDto,
  ): Promise<AdminConfigurationKeyDetail> {
    return this.configuration.detail(key, query.scopeId);
  }

  @Get(':key/history')
  async history(
    @Param('key') key: string,
    @Query() query: ConfigurationHistoryQueryDto,
  ): Promise<ConfigurationHistoryEntry[]> {
    return this.configuration.history(key, query);
  }

  /**
   * Set a value.
   *
   * `PUT` because it is idempotent in the way that matters: sending the same
   * value twice leaves the same value in force. It is not free of side effects
   * — the second write still records a history row — and that is correct, since
   * "an admin set this again, for this reason" is a fact about the system.
   */
  @Put(':key')
  @HttpCode(HttpStatus.OK)
  async set(
    @Param('key') key: string,
    @Body() body: SetConfigurationDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminConfigurationKeyDetail> {
    return this.configuration.set(
      key,
      body.value,
      {
        scope: body.scope,
        scopeId: body.scopeId,
        reason: body.reason,
        expectedUpdatedAt: body.expectedUpdatedAt,
      },
      { adminId: admin.id, ip: request.ip ?? null },
    );
  }

  /**
   * Remove an explicit setting, returning the key to its resolution chain.
   *
   * `POST .../reset` rather than `DELETE :key`, because `DELETE` on the key's
   * own URL reads as "delete this key" — and a key cannot be deleted. It is
   * declared in code by the module that owns the rule; only the *value* stored
   * against it can go away, and only at one scope at a time.
   */
  @Post(':key/reset')
  @HttpCode(HttpStatus.OK)
  async reset(
    @Param('key') key: string,
    @Body() body: ResetConfigurationDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminConfigurationKeyDetail> {
    return this.configuration.reset(
      key,
      {
        scope: body.scope,
        scopeId: body.scopeId,
        reason: body.reason,
        expectedUpdatedAt: body.expectedUpdatedAt,
      },
      { adminId: admin.id, ip: request.ip ?? null },
    );
  }
}
