import { Module } from '@nestjs/common';
import { FraudController } from './fraud.controller';
import { FraudService } from './fraud.service';
import { IpReputationService } from './ip-reputation';

@Module({
  controllers: [FraudController],
  providers: [FraudService, IpReputationService],
  exports: [FraudService],
})
export class FraudModule {}
