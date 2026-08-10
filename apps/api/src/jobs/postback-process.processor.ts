import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { ConversionProcessingResult } from '@gemone/contracts';
import type { Job } from 'bullmq';

import {
  POSTBACK_JOBS,
  QUEUES,
  type PostbackProcessJobData,
} from '../core/queue/queue.constants';
import { ConversionsService } from '../modules/conversions/conversions.service';

/**
 * How many postbacks are turned into conversions at once.
 *
 * §13.1 wants this queue's concurrency **high**: it is latency-sensitive and
 * the highest volume there will be, and it exists as its own queue precisely
 * so a burst of catalog syncs cannot starve it.
 *
 * The ceiling is not CPU, it is the connection pool. Each unit of work is a
 * handful of indexed queries plus one short transaction, so a worker running
 * more of these concurrently than `DATABASE_POOL_MAX` (default 10) simply
 * queues on connections — with the pool exhausted, nothing else in the process
 * can run either. Eight leaves headroom for whatever shares the pool.
 */
const CONCURRENCY = 8;

/**
 * The `postbacks` queue's consumer — ARCHITECTURE.md §10.3, §12.
 *
 * The queue has had a producer since the intake surface landed and no consumer
 * until now; this is that consumer.
 *
 * It is deliberately thin. Jobs orchestrate and hold no business logic of
 * their own (§12.2): this resolves the work to `ConversionsService` and reports
 * the outcome, which is why the whole attribution pipeline is testable without
 * a queue at all — and why the queue is testable by asserting that it calls it.
 *
 * Loaded only by `WorkerModule`. The `api` process enqueues and never consumes,
 * which is the entire reason the two entrypoints exist: attribution takes
 * several queries and a transaction, and sharing an event loop with it would
 * delay the postback acknowledgement that has to happen in milliseconds (§1.2).
 */
@Injectable()
@Processor(QUEUES.POSTBACKS, { concurrency: CONCURRENCY })
export class PostbackProcessProcessor extends WorkerHost {
  private readonly logger = new Logger(PostbackProcessProcessor.name);

  constructor(private readonly conversions: ConversionsService) {
    super();
  }

  async process(job: Job): Promise<ConversionProcessingResult> {
    if (job.name !== POSTBACK_JOBS.PROCESS) {
      // A job name nobody handles would otherwise be marked completed, which
      // is the quietest possible way for conversions to stop being recorded.
      throw new Error(`Unknown postback job: ${job.name}`);
    }

    const { postbackId } = (job as Job<PostbackProcessJobData>).data;

    /*
     * Failures are not caught here.
     *
     * `ConversionsService.process` already returns rather than throws for
     * every outcome a retry cannot change — an unattributable postback is
     * quarantined and reported as a normal result. Anything that still throws
     * is infrastructure, which is exactly what BullMQ's retry-and-then-
     * dead-letter is for (§13.2), and swallowing it here would mark the job
     * completed while the postback sat unprocessed.
     */
    const result = await this.conversions.process(postbackId);

    this.logger.log(
      {
        jobId: job.id,
        postbackId,
        outcome: result.outcome,
        conversionId: result.conversionId,
        reason: result.reason,
        attempt: job.attemptsMade + 1,
      },
      'Postback processing job finished',
    );

    return result;
  }
}

export const __testing = { CONCURRENCY };
