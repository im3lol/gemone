import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export type WalletDrift = {
  userId: string;
  balance: number;
  ledgerSum: number;
  drift: number; // balance - ledgerSum; 0 == healthy
};

// The core financial invariant: a wallet's stored balance must always equal the
// signed sum of its ledger entries. Every credit/reversal writes both in one
// transaction, so drift should be 0 — reconciliation is the safety net that
// proves it (and screams if a bug ever breaks it).
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcileUser(userId: string): Promise<WalletDrift> {
    const [agg, wallet] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { userId }, _sum: { points: true } }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
    ]);
    const ledgerSum = agg._sum.points ?? 0;
    const balance = wallet?.balance ?? 0;
    return { userId, balance, ledgerSum, drift: balance - ledgerSum };
  }

  // Two queries regardless of user count: group ledger sums, diff against wallets.
  async reconcileAll(): Promise<WalletDrift[]> {
    const [groups, wallets] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({ by: ['userId'], _sum: { points: true } }),
      this.prisma.wallet.findMany({ select: { userId: true, balance: true } }),
    ]);
    const ledgerByUser = new Map(groups.map((g) => [g.userId, g._sum.points ?? 0]));
    return wallets
      .map((w) => {
        const ledgerSum = ledgerByUser.get(w.userId) ?? 0;
        return { userId: w.userId, balance: w.balance, ledgerSum, drift: w.balance - ledgerSum };
      })
      .filter((r) => r.drift !== 0);
  }

  // ponytail: single-instance cron. Add a distributed lock (Redis) before running
  // more than one API replica, or drift will be logged N times.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightlyReconcile(): Promise<void> {
    const drifts = await this.reconcileAll();
    if (drifts.length === 0) {
      this.log.log('Reconciliation clean — all wallets match their ledger.');
      return;
    }
    this.log.error(`RECONCILIATION DRIFT on ${drifts.length} wallet(s): ${JSON.stringify(drifts)}`);
  }
}
