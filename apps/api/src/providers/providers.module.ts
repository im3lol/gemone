import { Module } from '@nestjs/common';
import { AdgemAdapter } from './adgem.adapter';
import { CpxAdapter } from './cpx.adapter';
import { ProvidersService } from './providers.service';

@Module({
  providers: [AdgemAdapter, CpxAdapter, ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
