import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KillSwitchService } from './killswitch.service';

class ToggleDto {
  @IsBoolean()
  halted!: boolean;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/kill-switch')
export class KillSwitchController {
  constructor(private readonly killSwitch: KillSwitchService) {}

  @Get()
  get() {
    return this.killSwitch.state();
  }

  @Post()
  async set(@Body() dto: ToggleDto) {
    if (dto.halted) await this.killSwitch.halt();
    else await this.killSwitch.resume();
    return this.killSwitch.state();
  }
}
