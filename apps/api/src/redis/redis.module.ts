import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

// Shared ioredis client for rate-limiting + health (separate from BullMQ's).
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new Redis({
          host: c.get('REDIS_HOST', 'localhost'),
          port: Number(c.get('REDIS_PORT', 6379)),
          maxRetriesPerRequest: null,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
