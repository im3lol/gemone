import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  USER_ROLES,
  type AdminPostbackDetail,
  type AdminPostbackSummary,
  type Paginated,
} from '@gemone/contracts';

import { createUuidPipe } from '../../core/errors/validation-pipe';
import { Roles } from '../auth/decorators';
import { PostbackIntakeService } from '../conversions/postback-intake.service';
import { ProvidersService } from '../providers/providers.service';
import { AdminListPostbacksDto } from './dto/postback.dto';

/**
 * Postback inspection for admins — PROJECT.md §4.9 ("conversion explorer with
 * raw postback payload inspection").
 *
 * **Read-only, and there is deliberately no write of any kind.** DATABASE.md
 * §3.4 says rows are never deleted or edited: they are the replay source when
 * processing has a bug, and the evidence in a provider dispute. An endpoint
 * that could edit one would let an admin change what a provider is recorded
 * as having sent, which is precisely the fact a dispute turns on.
 *
 * Retry and replay actions will arrive with processing, and they will change
 * a postback's *state*, never its payload.
 *
 * `@Roles(ADMIN)` sits on the controller so an endpoint added later is
 * protected by default rather than by someone remembering. The raw payload is
 * a provider's own data and never appears on a user-facing surface (§15.3).
 */
@Roles(USER_ROLES.ADMIN)
@Controller('admin/postbacks')
export class AdminPostbacksController {
  constructor(
    private readonly postbacks: PostbackIntakeService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  async list(
    @Query() query: AdminListPostbacksDto,
  ): Promise<Paginated<AdminPostbackSummary>> {
    const page = await this.postbacks.findMany(query);
    const slugs = await this.providerSlugs();

    return {
      ...page,
      items: page.items.map((postback) =>
        this.postbacks.toSummary(postback, slugs.get(postback.providerId) ?? 'unknown'),
      ),
    };
  }

  @Get(':id')
  async get(@Param('id', createUuidPipe()) id: string): Promise<AdminPostbackDetail> {
    const postback = await this.postbacks.requireById(id);
    const provider = await this.providers.requireById(postback.providerId);

    return this.postbacks.toDetail(postback, provider.slug);
  }

  /** One query for the page's provider slugs — §11.3's accepted trade. */
  private async providerSlugs(): Promise<Map<string, string>> {
    const providers = await this.providers.findAll();
    return new Map(providers.map((provider) => [provider.id, provider.slug]));
  }
}
