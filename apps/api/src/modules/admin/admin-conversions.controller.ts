import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  USER_ROLES,
  type AdminConversionSummary,
  type Paginated,
} from '@gemone/contracts';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import { Roles } from '../auth/decorators';
import { ConversionsService } from '../conversions/conversions.service';
import { ProvidersService } from '../providers/providers.service';
import { AdminListConversionsDto } from './dto/conversion.dto';

/**
 * Conversion inspection for admins — PROJECT.md §4.9's conversion explorer.
 *
 * **Read-only.** A conversion is what a user is owed for work they did; an
 * admin who could edit one could change what they are owed, and the reward
 * flow has not even credited it yet. The write actions this screen will
 * eventually need — clear a hold, approve a quarantined postback — change a
 * *status* through a state machine, and they arrive with the flow that gives
 * those statuses meaning.
 *
 * There is deliberately no user-facing conversion endpoint yet either. What a
 * user wants to know about a conversion is what it paid them, and that answer
 * does not exist until the reward flow does (TODO T25).
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/conversions')
export class AdminConversionsController {
  constructor(
    private readonly conversions: ConversionsService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  async list(
    @Query() query: AdminListConversionsDto,
  ): Promise<Paginated<AdminConversionSummary>> {
    const page = await this.conversions.findMany(query);
    const slugs = await this.providerSlugs();

    return {
      ...page,
      items: page.items.map((conversion) =>
        this.conversions.toAdminSummary(
          conversion,
          slugs.get(conversion.providerId) ?? 'unknown',
        ),
      ),
    };
  }

  @Get(':id')
  async get(@Param('id', createUuidPipe()) id: string): Promise<AdminConversionSummary> {
    const conversion = await this.conversions.requireById(id);
    const provider = await this.providers.requireById(conversion.providerId);

    return this.conversions.toAdminSummary(conversion, provider.slug);
  }

  /** One query for the page's provider slugs — §11.3's accepted trade. */
  private async providerSlugs(): Promise<Map<string, string>> {
    const providers = await this.providers.findAll();
    return new Map(providers.map((provider) => [provider.id, provider.slug]));
  }
}
