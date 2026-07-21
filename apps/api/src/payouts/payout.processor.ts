import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PAYOUT_QUEUE, PayoutJob } from './payout.queue';
import { PayoutsService } from './payouts.service';
import { PermanentPayoutError } from './providers/payout-provider';

// ponytail: runs in-process with the API. Split into a dedicated worker deployment
// (same image, different entrypoint) when payout volume needs isolating — plan phase 9.
@Processor(PAYOUT_QUEUE)
export class PayoutProcessor extends WorkerHost {
  private readonly log = new Logger(PayoutProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
  ) {
    super();
  }

  async process(job: Job<PayoutJob>): Promise<void> {
    const { withdrawalId } = job.data;
    const w = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w || (w.status !== 'APPROVED' && w.status !== 'PROCESSING')) {
      this.log.warn(`skip payout ${withdrawalId}: status=${w?.status ?? 'missing'}`);
      return; // already handled / cancelled
    }

    await this.payouts.markProcessing(withdrawalId);
    const provider = this.payouts.providerFor(w.method);

    try {
      const { ref } = await provider.pay({
        withdrawalId: w.id,
        points: w.points,
        amountUsd: w.amountUsd,
        method: w.method,
        destination: w.destination,
      });
      await this.payouts.markPaid(withdrawalId, ref);
      this.log.log(`paid ${withdrawalId} via ${provider.key} ref=${ref}`);
    } catch (err) {
      const permanent = err instanceof PermanentPayoutError;
      const attempts = job.opts.attempts ?? 1;
      const lastTry = job.attemptsMade + 1 >= attempts;

      if (permanent || lastTry) {
        const reason = err instanceof Error ? err.message : 'payout failed';
        await this.payouts.fail(withdrawalId, reason);
        this.log.error(`failed ${withdrawalId} (${permanent ? 'permanent' : 'exhausted'}): ${reason} — refunded`);
        return; // handled: do not rethrow (no further retries)
      }

      this.log.warn(`transient payout error ${withdrawalId}, retrying: ${String(err)}`);
      throw err; // let BullMQ retry with backoff
    }
  }
}
