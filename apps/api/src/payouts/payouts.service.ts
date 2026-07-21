import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { FraudService } from '../fraud/fraud.service';
import { KillSwitchService } from '../killswitch/killswitch.service';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYOUT_QUEUE } from './payout.queue';
import { PaypalProvider } from './providers/paypal.provider';
import { PayoutProvider } from './providers/payout-provider';
import { ReloadlyProvider } from './providers/reloadly.provider';
import { CreateWithdrawalDto } from './withdrawal.dto';

@Injectable()
export class PayoutsService {
  private readonly providers: PayoutProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fraud: FraudService,
    private readonly metrics: MetricsService,
    private readonly killSwitch: KillSwitchService,
    @InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue,
    paypal: PaypalProvider,
    reloadly: ReloadlyProvider,
  ) {
    this.providers = [paypal, reloadly];
  }

  private min() {
    return Number(this.config.get('MIN_WITHDRAWAL_POINTS', 5000));
  }
  private large() {
    return Number(this.config.get('LARGE_WITHDRAWAL_POINTS', 100000));
  }

  providerFor(method: string): PayoutProvider {
    const p = this.providers.find((x) => x.supports(method));
    if (!p) throw new BadRequestException(`Unsupported payout method: ${method}`);
    return p;
  }

  async get(id: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }

  listForUser(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  listPending() {
    return this.prisma.withdrawal.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Create a withdrawal and debit points atomically at request time. */
  async create(userId: string, dto: CreateWithdrawalDto) {
    if (await this.killSwitch.isHalted()) {
      throw new ServiceUnavailableException('Withdrawals are temporarily paused. Please try again later.');
    }
    this.providerFor(dto.method); // validate method up front
    await this.fraud.assertCanWithdraw(userId); // suspended accounts are blocked

    const [user, priorCount] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { wallet: true } }),
      this.prisma.withdrawal.count({ where: { userId } }),
    ]);

    if (!user.emailVerified) throw new ForbiddenException('Verify your email before withdrawing');
    if (dto.points < this.min()) throw new BadRequestException(`Minimum withdrawal is ${this.min()} points`);
    if (dto.points > (user.wallet?.balance ?? 0)) throw new BadRequestException('Insufficient balance');

    // First-ever request, large amounts, and flagged accounts hold for manual review.
    const flagged = await this.fraud.isFlaggedOrWorse(userId);
    const autoApprove = priorCount > 0 && dto.points < this.large() && !flagged;
    const amountUsd = (dto.points / 1000).toFixed(2);

    const created = await this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawal.create({
        data: {
          userId,
          points: dto.points,
          amountUsd,
          method: dto.method,
          destination: dto.destination,
          status: autoApprove ? 'APPROVED' : 'PENDING',
        },
      });
      await tx.wallet.update({ where: { userId }, data: { balance: { decrement: dto.points } } });
      await tx.ledgerEntry.create({
        data: { userId, points: -dto.points, type: 'WITHDRAWAL', reference: `withdrawal:${w.id}` },
      });
      return w;
    });

    if (autoApprove) await this.enqueue(created.id);
    return created;
  }

  async approve(id: string, adminId: string) {
    const upd = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedById: adminId },
    });
    if (upd.count === 0) throw new BadRequestException('Withdrawal is not pending review');
    await this.enqueue(id);
    return this.get(id);
  }

  async reject(id: string, adminId: string) {
    const upd = await this.prisma.withdrawal.updateMany({
      where: { id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'REJECTED', reviewedById: adminId },
    });
    if (upd.count === 0) throw new BadRequestException('Withdrawal cannot be rejected in its current state');
    await this.refund(id);
    return this.get(id);
  }

  // --- called by the payout worker ---

  async markProcessing(id: string) {
    await this.prisma.withdrawal.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PROCESSING' } });
  }

  async markPaid(id: string, providerRef: string) {
    await this.prisma.withdrawal.updateMany({
      where: { id, status: { in: ['APPROVED', 'PROCESSING'] } },
      data: { status: 'PAID', providerRef },
    });
  }

  async fail(id: string, reason: string) {
    await this.prisma.withdrawal.updateMany({
      where: { id, status: { in: ['APPROVED', 'PROCESSING'] } },
      data: { status: 'FAILED', failureReason: reason },
    });
    await this.refund(id);
    this.metrics.payoutFailures.inc();
  }

  private async enqueue(id: string) {
    // jobId = withdrawal id → a withdrawal is only ever queued once.
    await this.queue.add(
      'payout',
      { withdrawalId: id },
      { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: true },
    );
  }

  // Idempotent: the conditional refundedAt claim ensures points are returned once.
  private async refund(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.withdrawal.updateMany({
        where: { id, refundedAt: null },
        data: { refundedAt: new Date() },
      });
      if (claim.count === 0) return; // already refunded
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
      await tx.wallet.update({ where: { userId: w.userId }, data: { balance: { increment: w.points } } });
      await tx.ledgerEntry.create({
        data: { userId: w.userId, points: w.points, type: 'REVERSAL', reference: `withdrawal:${id}:refund` },
      });
    });
  }
}
