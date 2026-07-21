import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { ProvidersModule } from '../providers/providers.module';
import { PostbackController } from './postback.controller';
import { PostbackService } from './postback.service';

@Module({
  imports: [ProvidersModule, FraudModule],
  controllers: [PostbackController],
  providers: [PostbackService],
})
export class PostbackModule {}
