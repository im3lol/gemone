import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FraudService } from './fraud.service';

class SetStatusDto {
  @IsIn(['ACTIVE', 'FLAGGED', 'SUSPENDED'])
  status!: 'ACTIVE' | 'FLAGGED' | 'SUSPENDED';
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/fraud')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get('logs')
  logs() {
    return this.fraud.recentLogs();
  }

  @Get('flagged')
  flagged() {
    return this.fraud.flaggedUsers();
  }

  @Post('users/:id/status')
  async setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    await this.fraud.setStatus(id, dto.status);
    return { id, status: dto.status };
  }
}
