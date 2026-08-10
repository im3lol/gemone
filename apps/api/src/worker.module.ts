import { Module } from '@nestjs/common';

import { AppModule } from './app.module';
import { JobsModule } from './jobs/jobs.module';

/**
 * The `worker` process's root — ARCHITECTURE.md §1.2.
 *
 * `AppModule` plus the consumers. The two processes share every service,
 * model and migration, and differ in exactly one thing: this one pulls in
 * `JobsModule`.
 *
 * Composed here rather than by branching on `APP_ROLE` inside `AppModule`.
 * A conditional import would have to read the environment while the module
 * graph is being *decorated*, which happens before the entrypoint has loaded
 * `.env` — so the branch would silently take the wrong path in development and
 * the right one in production, which is the worst way round.
 */
@Module({
  imports: [AppModule, JobsModule],
})
export class WorkerModule {}
