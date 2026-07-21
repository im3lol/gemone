import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DailyBonusModule } from './daily-bonus/daily-bonus.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FraudModule } from './fraud/fraud.module';
import { KillSwitchModule } from './killswitch/killswitch.module';
import { ObservabilityModule } from './observability/metrics.module';
import { OffersModule } from './offers/offers.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PostbackModule } from './postback/postback.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReferralsModule } from './referrals/referrals.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Never log credentials.
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
      },
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    // Redis-backed rate limiting so limits hold across API replicas.
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        connection: {
          host: c.get('REDIS_HOST', 'localhost'),
          port: Number(c.get('REDIS_PORT', 6379)),
        },
      }),
    }),
    PrismaModule,
    ObservabilityModule,
    AuthModule,
    DashboardModule,
    OffersModule,
    PostbackModule,
    WalletModule,
    PayoutsModule,
    FraudModule,
    KillSwitchModule,
    AdminModule,
    TransactionsModule,
    ReferralsModule,
    DailyBonusModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
