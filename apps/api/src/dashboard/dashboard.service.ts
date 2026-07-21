import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const POINTS_PER_USD = 1000; // design: 12,560 pts ≈ $12.56
const XP_PER_LEVEL = 5000;

function rankFor(level: number): string {
  if (level >= 20) return 'Diamond';
  if (level >= 15) return 'Gold';
  if (level >= 10) return 'Amethyst';
  if (level >= 5) return 'Silver';
  return 'Bronze';
}

const usd = (points: number) => (points / POINTS_PER_USD).toFixed(2);

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todays, completedOffers, activities] = await Promise.all([
      this.prisma.activity.aggregate({
        where: { userId, createdAt: { gte: startOfToday }, points: { gt: 0 } },
        _sum: { points: true },
      }),
      this.prisma.activity.count({ where: { userId, kind: 'offer' } }),
      this.prisma.activity.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, kind: true, title: true, points: true, createdAt: true },
      }),
    ]);

    const balance = user.wallet?.balance ?? 0;
    const pending = user.wallet?.pending ?? 0;
    const todaysEarnings = todays._sum.points ?? 0;

    return {
      user: {
        displayName: user.displayName,
        level: user.level,
        rank: rankFor(user.level),
        xp: user.xp,
        xpNext: XP_PER_LEVEL,
      },
      stats: {
        balance,
        balanceUsd: usd(balance),
        todaysEarnings,
        todaysEarningsUsd: usd(todaysEarnings),
        pending,
        pendingUsd: usd(pending),
        completedOffers,
      },
      recentActivity: activities,
    };
  }
}
