import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const POINTS_PER_USD = 1000;
export const REFERRAL_PERCENT = 10; // must match REFERRAL_RATE in postback.service

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string) {
    const [user, invited, commission] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.ledgerEntry.aggregate({
        where: { userId, reference: { startsWith: 'referral:' } },
        _sum: { points: true },
      }),
    ]);

    const commissionPoints = commission._sum.points ?? 0;
    return {
      code: user?.referralCode ?? null,
      percent: REFERRAL_PERCENT,
      invited,
      commissionPoints,
      commissionUsd: (commissionPoints / POINTS_PER_USD).toFixed(2),
    };
  }
}
