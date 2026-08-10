import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ENV } from '../config/env.module';
import type { Env } from '../config/env.schema';
import { InvalidationBus } from './invalidation.bus';
import {
  INVALIDATION_PUBLISHER,
  INVALIDATION_PUBLISHER_NAME,
  INVALIDATION_SUBSCRIBER,
  INVALIDATION_SUBSCRIBER_NAME,
} from './invalidation.constants';

/**
 * Cross-process notification — ARCHITECTURE.md §14.3.
 *
 * Global for the same reason `ConfigurationModule` and `QueueModule` are: the
 * caches that need it are themselves global, and threading an import through
 * every module that holds one would add ceremony without adding a boundary.
 *
 * Placed in `core` and depending on nothing above it. `core/config` and
 * `modules/providers` both reach *down* to the bus and register a handler; the
 * bus never reaches back up, and never learns what a configuration key or a
 * provider is (§5, rule 2). The whole coupling is two `subscribe()` calls.
 *
 * ## Why the connections are created here and not reused from `QueueModule`
 *
 * `QueueModule` exports a `REDIS_CONNECTION`, and borrowing it would save one
 * socket. It is not shared for two reasons that are not about tidiness:
 * a subscriber connection is unusable for anything else while subscribed, so a
 * second connection has to exist regardless; and that one is configured for a
 * health probe (`maxRetriesPerRequest: 1`), which is the wrong shape for both
 * halves of this job. Owning both makes each one's settings answer to the job
 * it actually does.
 */
@Global()
@Module({
  providers: [
    {
      provide: INVALIDATION_PUBLISHER,
      inject: [ENV],
      useFactory: (env: Env): Redis =>
        new Redis(env.REDIS_URL, {
          /*
           * Fail fast, both of them.
           *
           * With the offline queue enabled, a publish issued while Redis is
           * unreachable waits in memory instead of failing — so an admin's
           * write would hang on a notification that is explicitly optional
           * (§14.4). Rejecting immediately is what lets `publish()` catch it,
           * log it, and let the request finish.
           */
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: INVALIDATION_PUBLISHER_NAME,
        }),
    },
    {
      provide: INVALIDATION_SUBSCRIBER,
      inject: [ENV],
      useFactory: (env: Env): Redis =>
        new Redis(env.REDIS_URL, {
          /*
           * The opposite trade, for the opposite job. A subscriber exists to
           * still be listening after an outage, so it retries indefinitely;
           * `null` is ioredis's documented setting for a connection that must
           * not give up. Nothing waits on it, so nothing can be held up by it.
           */
          maxRetriesPerRequest: null,
          connectionName: INVALIDATION_SUBSCRIBER_NAME,
        }),
    },
    InvalidationBus,
  ],
  exports: [InvalidationBus],
})
export class EventsModule {}
