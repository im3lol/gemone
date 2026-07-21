import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const POINTS_PER_USD = 1000;
const usd = (points: number) => (points / POINTS_PER_USD).toFixed(2);
const DAY = 86_400_000;

// Bucket rows into 7 daily totals (oldest→newest) using valueFn per row.
function weekBuckets<T>(rows: T[], date: (r: T) => Date, value: (r: T) => number, now: number) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() - (6 - i) * DAY));
  const totals = new Array(7).fill(0);
  for (const r of rows) {
    const t = date(r).getTime();
    for (let i = 6; i >= 0; i--) {
      if (t >= days[i].getTime()) {
        totals[i] += value(r);
        break;
      }
    }
  }
  const labels = days.map((d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  return { labels, totals };
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async stats() {
    const now = Date.now();
    const since7 = new Date(now - 7 * DAY);

    const [
      users,
      new7d,
      active,
      flagged,
      suspended,
      earnAgg,
      paidAgg,
      offersCompleted,
      reversals,
      credits,
      paidCount,
      failedCount,
      suspiciousSignups,
      blockedIps,
      fraudBlocked,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since7 } } }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'FLAGGED' } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.ledgerEntry.aggregate({ _sum: { points: true }, where: { type: 'EARN' } }),
      this.prisma.withdrawal.aggregate({ _sum: { points: true }, where: { status: 'PAID' } }),
      this.prisma.activity.count({ where: { kind: 'offer' } }),
      this.prisma.postbackEvent.count({ where: { type: 'reversal' } }),
      this.prisma.postbackEvent.count({ where: { type: 'credit' } }),
      this.prisma.withdrawal.count({ where: { status: 'PAID' } }),
      this.prisma.withdrawal.count({ where: { status: 'FAILED' } }),
      this.prisma.fraudLog.count({ where: { type: { in: ['duplicate_ip', 'duplicate_device', 'vpn'] } } }),
      this.prisma.fraudLog.count({ where: { type: 'vpn' } }),
      this.prisma.fraudLog.count(),
    ]);

    const [earnRows, paidRows, fraudRows, userRows, offerRows, recent, offerGroups, countryGroups] =
      await Promise.all([
        this.prisma.ledgerEntry.findMany({ where: { type: 'EARN', createdAt: { gte: since7 } }, select: { points: true, createdAt: true } }),
        this.prisma.withdrawal.findMany({ where: { status: 'PAID', createdAt: { gte: since7 } }, select: { points: true, createdAt: true } }),
        this.prisma.fraudLog.findMany({ where: { createdAt: { gte: since7 } }, select: { createdAt: true } }),
        this.prisma.user.findMany({ where: { createdAt: { gte: since7 } }, select: { createdAt: true } }),
        this.prisma.activity.findMany({ where: { kind: 'offer', createdAt: { gte: since7 } }, select: { createdAt: true } }),
        this.prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 6, include: { user: { select: { displayName: true, email: true } } } }),
        this.prisma.activity.groupBy({ by: ['title'], where: { kind: 'offer' }, _count: { _all: true }, _sum: { points: true }, orderBy: { _sum: { points: 'desc' } }, take: 5 }),
        this.prisma.user.groupBy({ by: ['country'], where: { country: { not: null } }, _count: { _all: true }, orderBy: { _count: { country: 'desc' } }, take: 5 }),
      ]);

    const earnings = weekBuckets(earnRows, (r) => r.createdAt, (r) => r.points, now);
    const payouts = weekBuckets(paidRows, (r) => r.createdAt, (r) => r.points, now);
    const fraud = weekBuckets(fraudRows, (r) => r.createdAt, () => 1, now);
    const newUsers = weekBuckets(userRows, (r) => r.createdAt, () => 1, now);
    const offers = weekBuckets(offerRows, (r) => r.createdAt, () => 1, now);

    return {
      totals: {
        users,
        new7d,
        active,
        flagged,
        suspended,
        earningsUsd: usd(earnAgg._sum.points ?? 0),
        paidUsd: usd(paidAgg._sum.points ?? 0),
        offersCompleted,
        fraudBlocked,
      },
      series: {
        days: earnings.labels,
        earningsUsd: earnings.totals.map((p) => Math.round(p / POINTS_PER_USD)),
        payoutsUsd: payouts.totals.map((p) => Math.round(p / POINTS_PER_USD)),
        fraud: fraud.totals,
        users: newUsers.totals,
        offers: offers.totals,
      },
      recentWithdrawals: recent.map((w) => ({
        name: w.user.displayName ?? w.user.email,
        method: w.method,
        amountUsd: w.amountUsd,
        status: w.status,
        date: w.createdAt,
      })),
      offerPerformance: offerGroups.map((g) => ({
        title: g.title,
        completions: g._count._all,
        earningsUsd: usd(g._sum.points ?? 0),
      })),
      topCountries: countryGroups.map((g) => ({ code: g.country as string, users: g._count._all })),
      fraud: { suspiciousSignups, blockedIps, chargebacks: reversals },
      kpis: {
        trustScore: pct(active, users),
        chargebackRate: pct(reversals, credits),
        payoutSuccessRate: pct(paidCount, paidCount + failedCount),
      },
    };
  }

  async users(q?: string) {
    return this.prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : undefined,
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        country: true,
        createdAt: true,
        wallet: { select: { balance: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
