import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';

@UseGuards(JwtAuthGuard)
@Controller('offers')
export class OffersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { country: true },
    });
    const offers = await this.providers.getOffers({
      userId: user.id,
      country: row?.country ?? null,
    });
    return { offers };
  }
}
