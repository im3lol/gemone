import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { ClickResponse, ClickSummary, Paginated } from '@gemone/contracts';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { ProvidersService } from '../providers/providers.service';
import { ClicksService } from './clicks.service';
import { CreateClickDto, ListClicksDto } from './dto/clicks.dto';

/**
 * The click surface — ARCHITECTURE.md §4 ("authenticated"), §6.2.
 *
 * Authenticated, and therefore never anonymous: a click that cannot be
 * attributed to an account is a promise to nobody. The global `JwtAuthGuard`
 * also re-reads the user's status on every request (§8.3), so a suspended
 * account stops being able to click within the same request rather than when
 * its token happens to expire.
 *
 * **Returns JSON, not a 302.** The browser never calls this API directly
 * (§6.1) — SvelteKit does, server-side — so a redirect here would be followed
 * by the BFF rather than the user, and the BFF would have to read `Location`
 * and re-issue it anyway. Handing back the URL lets `web` issue the redirect
 * and a future mobile client (§21) open it natively, from one endpoint.
 * Recorded in DECISIONS.md (D20).
 */
@Controller('clicks')
export class ClicksController {
  constructor(
    private readonly clicks: ClicksService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Records the click and returns where to send the user.
   *
   * The evidence — IP, user agent, referrer — is read from the request here
   * rather than accepted in the body. A client that could state its own IP
   * would make the per-IP limit advisory, and would poison the geo-mismatch
   * check `fraud` will run against it later.
   */
  @Post()
  async create(
    @Body() dto: CreateClickDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<ClickResponse> {
    return this.clicks.create({
      userId: user.id,
      offerId: dto.offerId,
      ipAddress: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
      deviceFingerprint: dto.deviceFingerprint ?? null,
      referrer: request.get('referer') ?? null,
    });
  }

  /**
   * The caller's own clicks, newest first.
   *
   * Scoped to the authenticated user inside the service, not by a filter the
   * caller supplies — resource ownership is the service's job (§6.2), and an
   * ownership check expressed as a query parameter is one a caller can change.
   */
  @Get('me')
  async listMine(
    @Query() query: ListClicksDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<ClickSummary>> {
    const page = await this.clicks.findManyForUser(user.id, query);
    const slugs = await this.providerSlugs();

    return {
      ...page,
      items: page.items.map((click) =>
        this.clicks.toSummary(click, slugs.get(click.providerId) ?? 'unknown'),
      ),
    };
  }

  /**
   * One query for the page's provider slugs.
   *
   * §11.3 accepts several queries where one join would do, so module
   * boundaries survive. The trade is kept to one extra query per page rather
   * than one per row.
   */
  private async providerSlugs(): Promise<Map<string, string>> {
    const providers = await this.providers.findAll();
    return new Map(providers.map((provider) => [provider.id, provider.slug]));
  }
}
