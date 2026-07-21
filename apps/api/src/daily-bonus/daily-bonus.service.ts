import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
const CLAIM_WINDOW = DAY; // one claim per 24h
const STREAK_GRACE = 2 * DAY; // miss more than this and the streak resets
// Reward per day of a 7-day cycle; day 7 pays a bonus, then it cycles.
const REWARDS = [50, 60, 70, 80, 90, 100, 150];

function rewardFor(streak: number): number {
  return REWARDS[(streak - 1) % REWARDS.length];
}

@Injectable()
export class DailyBonusService {
  constructor(private readonly prisma: PrismaService) {}

  async state(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastBonusAt: true, bonusStreak: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.describe(user.lastBonusAt, user.bonusStreak);
  }

  async claim(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastBonusAt: true, bonusStreak: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = Date.now();
    const since = user.lastBonusAt ? now - user.lastBonusAt.getTime() : Infinity;
    if (since < CLAIM_WINDOW) {
      throw new BadRequestException('Daily bonus already claimed — come back tomorrow.');
    }

    // Continue the streak if the last claim was recent enough, else start over.
    const streak = since <= STREAK_GRACE ? user.bonusStreak + 1 : 1;
    const reward = rewardFor(streak);
    const claimedAt = new Date(now);

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({ where: { userId }, data: { balance: { increment: reward } } });
      await tx.ledgerEntry.create({ data: { userId, points: reward, type: 'BONUS', reference: 'daily-bonus' } });
      await tx.activity.create({ data: { userId, kind: 'bonus', title: 'Daily Bonus Claimed', points: reward } });
      await tx.user.update({ where: { id: userId }, data: { lastBonusAt: claimedAt, bonusStreak: streak } });
    });

    return { reward, ...this.describe(claimedAt, streak) };
  }

  private describe(lastBonusAt: Date | null, streak: number) {
    const now = Date.now();
    const since = lastBonusAt ? now - lastBonusAt.getTime() : Infinity;
    const broken = since > STREAK_GRACE;
    const currentStreak = broken ? 0 : streak;
    const canClaim = since >= CLAIM_WINDOW;

    // Streak after a claim-now, used to preview today's reward + stepper position.
    const nextStreak = broken ? 1 : streak + (canClaim ? 1 : 0);
    const weekDay = ((nextStreak - 1) % REWARDS.length) + 1; // 1..7

    return {
      streak: currentStreak,
      weekDay,
      canClaim,
      nextClaimAt: lastBonusAt && !canClaim ? new Date(lastBonusAt.getTime() + CLAIM_WINDOW).toISOString() : null,
      todayReward: rewardFor(nextStreak),
      rewards: REWARDS,
    };
  }
}
