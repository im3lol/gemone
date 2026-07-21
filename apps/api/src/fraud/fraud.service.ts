import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { IpReputationService } from './ip-reputation';

type Severity = 'low' | 'medium' | 'high';

export type SignupContext = {
  userId: string;
  email: string;
  ip?: string | null;
  deviceHash?: string | null;
};

@Injectable()
export class FraudService {
  private readonly log = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ipRep: IpReputationService,
  ) {}

  private num(key: string, def: number) {
    return Number(this.config.get(key, def));
  }

  /** Runs at signup: duplicate IP/device + VPN checks. Flags, never blocks signup. */
  async screenSignup(ctx: SignupContext): Promise<void> {
    const checks: Promise<void>[] = [];

    if (ctx.ip) {
      checks.push(
        this.prisma.user
          .count({ where: { signupIp: ctx.ip, id: { not: ctx.userId } } })
          .then(async (dupes) => {
            if (dupes >= this.num('FRAUD_MAX_ACCOUNTS_PER_IP', 2)) {
              await this.flag(ctx.userId, 'duplicate_ip', dupes >= 4 ? 'high' : 'medium', `${dupes} accounts share IP ${ctx.ip}`);
            }
          }),
      );
      checks.push(
        this.ipRep.check(ctx.ip).then(async (v) => {
          if (v.vpn || v.proxy) {
            await this.flag(ctx.userId, 'vpn', 'high', `VPN/proxy IP (score ${v.fraudScore})`);
          }
        }),
      );
    }

    if (ctx.deviceHash) {
      checks.push(
        this.prisma.user
          .count({ where: { deviceHash: ctx.deviceHash, id: { not: ctx.userId } } })
          .then(async (dupes) => {
            if (dupes >= 1) {
              await this.flag(ctx.userId, 'duplicate_device', dupes >= 3 ? 'high' : 'medium', `${dupes} accounts share device ${ctx.deviceHash}`);
            }
          }),
      );
    }

    await Promise.all(checks);
  }

  /** Runs after a postback credit: abnormal earning rate in a short window. */
  async checkVelocity(userId: string): Promise<void> {
    const windowMin = this.num('FRAUD_VELOCITY_WINDOW_MIN', 10);
    const limit = this.num('FRAUD_VELOCITY_POINTS', 20000);
    const since = new Date(Date.now() - windowMin * 60_000);
    const agg = await this.prisma.activity.aggregate({
      where: { userId, createdAt: { gte: since }, points: { gt: 0 } },
      _sum: { points: true },
    });
    const earned = agg._sum.points ?? 0;
    if (earned > limit) {
      await this.flag(userId, 'velocity', 'high', `${earned} pts in ${windowMin}m (limit ${limit})`);
    }
  }

  /** Runs after a reversal: too many reversals → auto-suspend the account. */
  async onReversal(userId: string): Promise<void> {
    const windowH = this.num('FRAUD_REVERSAL_WINDOW_H', 24);
    const limit = this.num('FRAUD_MAX_REVERSALS', 3);
    const since = new Date(Date.now() - windowH * 3_600_000);
    const reversals = await this.prisma.postbackEvent.count({
      where: { userId, type: 'reversal', createdAt: { gte: since } },
    });
    if (reversals >= limit) {
      await this.suspend(userId, `${reversals} reversals in ${windowH}h`);
    }
  }

  /** Called from the withdrawal path. Suspended = blocked; flagged is handled by the caller. */
  async assertCanWithdraw(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (user?.status === 'SUSPENDED') {
      throw new ForbiddenException('Account under review — withdrawals are suspended');
    }
  }

  async isFlaggedOrWorse(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    return user?.status === 'FLAGGED' || user?.status === 'SUSPENDED';
  }

  async flag(userId: string, type: string, severity: Severity, detail: string): Promise<void> {
    await this.prisma.fraudLog.create({ data: { userId, type, severity, detail } });
    // A high-severity signal escalates an active account to FLAGGED (not past SUSPENDED).
    if (severity === 'high') {
      await this.prisma.user.updateMany({
        where: { id: userId, status: 'ACTIVE' },
        data: { status: 'FLAGGED' },
      });
    }
    this.log.warn(`fraud[${severity}] ${type} user=${userId}: ${detail}`);
  }

  async suspend(userId: string, reason: string): Promise<void> {
    await this.prisma.fraudLog.create({ data: { userId, type: 'reversal_abuse', severity: 'high', detail: reason } });
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    this.log.error(`SUSPENDED user=${userId}: ${reason}`);
  }

  async setStatus(userId: string, status: 'ACTIVE' | 'FLAGGED' | 'SUSPENDED'): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  recentLogs(take = 50) {
    return this.prisma.fraudLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  flaggedUsers() {
    return this.prisma.user.findMany({
      where: { status: { in: ['FLAGGED', 'SUSPENDED'] } },
      select: { id: true, email: true, status: true, signupIp: true, createdAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
