import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  USER_ROLES,
  type AdminClickSummary,
  type Paginated,
} from '@gemone/contracts';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import { Roles } from '../auth/decorators';
import { ClicksService } from '../clicks/clicks.service';
import { ProvidersService } from '../providers/providers.service';
import { AdminListClicksDto } from './dto/click.dto';

/**
 * Click inspection for admins — PROJECT.md §3.3 ("inspect any user: profile,
 * devices, IPs, clicks, conversions").
 *
 * **Read-only, and there is deliberately no write of any kind.** A click is
 * the promise made to a user and the evidence behind every "I completed this
 * and was not paid" ticket. An endpoint that could edit or delete one would
 * make the record arguable exactly where it needs to be unarguable — and an
 * admin who could rewrite a click could rewrite what a user was owed.
 *
 * `@Roles(ADMIN)` on the controller, so an endpoint added later is protected
 * by default rather than by someone remembering.
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/clicks')
export class AdminClicksController {
  constructor(
    private readonly clicks: ClicksService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  async list(@Query() query: AdminListClicksDto): Promise<Paginated<AdminClickSummary>> {
    const page = await this.clicks.findMany(query);
    const slugs = await this.providerSlugs();

    return {
      ...page,
      items: page.items.map((click) =>
        this.clicks.toAdminSummary(click, slugs.get(click.providerId) ?? 'unknown'),
      ),
    };
  }

  @Get(':id')
  async get(@Param('id', createUuidPipe()) id: string): Promise<AdminClickSummary> {
    const click = await this.clicks.requireById(id);
    const provider = await this.providers.requireById(click.providerId);

    return this.clicks.toAdminSummary(click, provider.slug);
  }

  private async providerSlugs(): Promise<Map<string, string>> {
    const providers = await this.providers.findAll();
    return new Map(providers.map((provider) => [provider.id, provider.slug]));
  }
}
