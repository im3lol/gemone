import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutsService } from './payouts.service';
import { CreateWithdrawalDto } from './withdrawal.dto';

@UseGuards(JwtAuthGuard)
@Controller('withdrawals')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWithdrawalDto) {
    return this.payouts.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.payouts.listForUser(user.id);
  }
}
