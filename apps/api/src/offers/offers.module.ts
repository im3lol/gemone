import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { OffersController } from './offers.controller';

@Module({
  imports: [ProvidersModule],
  controllers: [OffersController],
})
export class OffersModule {}
