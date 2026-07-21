import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FraudService } from '../fraud/fraud.service';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import type { ParsedPostback, PostbackQuery } from '../providers/provider.types';

export type PostbackOutcome = 'credited' | 'reversed' | 'duplicate';

const REFERRAL_RATE = 0.1; // inviter earns 10% of a referred user's credited earnings

@Injectable()
export class PostbackService {
  private readonly log = new Logger(PostbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly fraud: FraudService,
    private readonly metrics: MetricsService,
  ) {}

  async handle(provider: string, query: PostbackQuery): Promise<{ status: PostbackOutcome; ack: string }> {
    const adapter = this.providers.get(provider);
    if (!adapter) throw new NotFoundException(`Unknown provider: ${provider}`);

    if (!adapter.verify(query)) {
      // Rejected postbacks are logged, never persisted — a forged tx must not be
      // able to occupy the idempotency key and block a later genuine one.
      this.log.warn(`[${provider}] rejected postback: bad signature (tx=${query.transaction_id ?? query.trans_id ?? '?'})`);
      throw new ForbiddenException('Invalid signature');
    }

    const parsed = adapter.parse(query);
    if (!parsed) throw new BadRequestException('Missing required postback params');

    const status = await this.process(provider, parsed);
    this.log.log(`[${provider}] ${status} tx=${parsed.transactionId} user=${parsed.userId} pts=${parsed.points}`);
    return { status, ack: adapter.ack() };
  }

  private async process(provider: string, p: ParsedPostback): Promise<PostbackOutcome> {
    const user = await this.prisma.user.findUnique({
      where: { id: p.userId },
      select: { id: true, referredById: true },
    });
    if (!user) throw new BadRequestException('Unknown user');

    const delta = p.type === 'reversal' ? -p.points : p.points;

    try {
      await this.prisma.$transaction(
        async (tx) => {
        // Idempotency guard: unique(provider, transactionId, type). A replayed
        // postback throws P2002 here and nothing below runs.
        await tx.postbackEvent.create({
          data: {
            provider,
            transactionId: p.transactionId,
            type: p.type,
            userId: p.userId,
            offerId: p.offerId,
            title: p.title,
            points: p.points,
          },
        });

        // Atomic balance change (SQL UPDATE ... balance = balance + delta).
        await tx.wallet.update({
          where: { userId: p.userId },
          data: { balance: { increment: delta } },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: p.userId,
            points: delta,
            type: p.type === 'reversal' ? 'REVERSAL' : 'EARN',
            reference: `${provider}:${p.transactionId}`,
          },
        });

        if (p.type === 'credit') {
          await tx.activity.create({
            data: { userId: p.userId, kind: 'offer', title: p.title ?? 'Offer Completed', points: p.points },
          });

          // Referral commission: pay the inviter 10% of this credit, same tx so it
          // can't drift from the earning. ponytail: no clawback on reversal yet —
          // add a matching debit in the reversal branch if abuse shows up.
          const commission = Math.floor(delta * REFERRAL_RATE);
          if (user.referredById && commission > 0) {
            await tx.wallet.update({
              where: { userId: user.referredById },
              data: { balance: { increment: commission } },
            });
            await tx.ledgerEntry.create({
              data: { userId: user.referredById, points: commission, type: 'BONUS', reference: `referral:${p.userId}` },
            });
            await tx.activity.create({
              data: { userId: user.referredById, kind: 'bonus', title: 'Referral commission', points: commission },
            });
          }
        }
        },
        // A burst of postbacks for the same user serializes on the wallet row.
        // Give connection-wait + tx room so they queue instead of erroring under load.
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return 'duplicate'; // already processed — safe no-op
      }
      throw e;
    }

    if (p.type === 'reversal') this.metrics.reversals.inc();
    else this.metrics.creditsGranted.inc();

    // Fraud signals run after the money moves (best-effort; never fail the postback).
    try {
      if (p.type === 'reversal') await this.fraud.onReversal(p.userId);
      else await this.fraud.checkVelocity(p.userId);
    } catch (err) {
      this.log.error(`fraud check failed for ${p.userId}: ${String(err)}`);
    }

    return p.type === 'reversal' ? 'reversed' : 'credited';
  }
}
