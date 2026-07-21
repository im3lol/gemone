import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutsService } from './payouts.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/withdrawals')
export class PayoutsAdminController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  pending() {
    return this.payouts.listPending();
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.payouts.approve(id, admin.id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() admin: AuthUser) {
    return this.payouts.reject(id, admin.id);
  }
}
