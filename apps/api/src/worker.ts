import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { loadEnv } from './core/config/env.schema';
import { loadDotenvForDevelopment } from './core/config/load-dotenv';
import { WorkerModule } from './worker.module';

/**
 * The `worker` entrypoint — queue consumers and scheduled jobs (§1.2).
 *
 * Same image and same module graph as `api`, no HTTP listener. The processes
 * are separated because a postback handler must acknowledge in milliseconds
 * while catalog syncs and reconciliation take seconds to minutes; sharing a
 * process means a slow job's event-loop pressure delays a postback ack, and a
 * delayed ack is a duplicate we then have to deduplicate.
 *
 * Consumers live in `WorkerModule`, which is `AppModule` plus `JobsModule`.
 * The `api` process loads `AppModule` alone, so it can enqueue work onto the
 * same queues and never picks any up.
 */
async function bootstrap(): Promise<void> {
  loadDotenvForDevelopment();
  const env = loadEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const logger = app.get(Logger);
  logger.log({ msg: 'worker started', role: 'worker', env: env.NODE_ENV });
}

void bootstrap();
