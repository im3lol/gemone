import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DailyBonusService } from './daily-bonus.service';

@UseGuards(JwtAuthGuard)
@Controller('daily-bonus')
export class DailyBonusController {
  constructor(private readonly bonus: DailyBonusService) {}

  @Get()
  state(@CurrentUser() user: AuthUser) {
    return this.bonus.state(user.id);
  }

  @Post('claim')
  claim(@CurrentUser() user: AuthUser) {
    return this.bonus.claim(user.id);
  }
}
