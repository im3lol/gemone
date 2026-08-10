import { CONVERSION_STATUSES, CONVERSION_TYPES } from '@gemone/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service';
import type { Click, User } from '../../generated/prisma/client';
import { ClicksService } from '../clicks/clicks.service';
import type { FraudEvaluationContext } from '../fraud/contracts/fraud-context';
import { FraudService } from '../fraud/fraud.service';

/**
 * Assembles the plain object `fraud` scores — ARCHITECTURE.md §4.2 step one.
 *
 * *"This costs the caller a few lines of assembly and buys: no cycle, a rule
 * engine testable with plain objects and no database, and the ability to replay
 * historical scoring decisions later by reconstructing the input."*
 *
 * These are the few lines. They live in `conversions` rather than in `fraud`
 * because every query below is against a table `conversions` or `clicks` owns,
 * and the arrow only points one way (§4.1: `conversions ──► fraud`, call-in
 * only).
 *
 * ## Why the counters come from Postgres and not Redis
 *
 * DATABASE.md §11.2 says `fraud` reads velocity counters from Redis through
 * `core/cache`. That half is deferred, deliberately and with a trigger (D49,
 * TODO T15): these counts decide whether to withhold someone's money, exact
 * counts are what Postgres gives, and `core/cache` does not exist. The boundary
 * §11.2 is actually protecting — that `fraud` never queries `clicks` — is fully
 * intact either way, because `fraud` is not the thing doing the reading.
 */
@Injectable()
export class FraudContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clicks: ClicksService,
    private readonly fraud: FraudService,
  ) {}

  /**
   * Everything the rules need, counted at `now`.
   *
   * Runs before the crediting transaction opens, never inside it — six queries
   * holding a balance row locked would make every other credit for this user
   * wait on a fraud check (§10.2 rule 4, the same reason rate resolution is
   * hoisted out).
   */
  async build(input: {
    user: User;
    click: Click;
    providerId: string;
    occurredAt: Date;
    now: Date;
  }): Promise<FraudEvaluationContext> {
    const { user, click, providerId, occurredAt, now } = input;

    const { velocityWindowMinutes, sharedIdentityWindowDays } =
      await this.fraud.windowsFor(providerId);

    const velocitySince = new Date(now.getTime() - velocityWindowMinutes * 60_000);
    const identitySince = new Date(now.getTime() - sharedIdentityWindowDays * 86_400_000);

    const [
      userConversionsInWindow,
      lifetimeConversions,
      lifetimeChargebacks,
      ipConversionsInWindow,
      accountsSharingIp,
      accountsSharingDevice,
    ] = await Promise.all([
      this.countUserConversionsSince(user.id, velocitySince),
      this.countLifetimeConversions(user.id),
      this.countLifetimeChargebacks(user.id),
      this.countIpConversionsSince(click.ipAddress, velocitySince),
      click.ipAddress === null
        ? Promise.resolve(null)
        : this.clicks.countOtherAccountsSharingIp(click.ipAddress, user.id, identitySince),
      click.deviceFingerprint === null
        ? Promise.resolve(null)
        : this.clicks.countOtherAccountsSharingDevice(
            click.deviceFingerprint,
            user.id,
            identitySince,
          ),
    ]);

    return {
      userId: user.id,
      providerId,
      emailDomain: emailDomainOf(user.email),
      accountCreatedAt: user.createdAt,

      clickAt: click.createdAt,
      clickIp: click.ipAddress,
      clickDeviceFingerprint: click.deviceFingerprint,

      /*
       * The provider's timestamp when there is one, ours otherwise.
       *
       * `occurredAt` is nullable — not every network reports one — and the
       * timing rule needs *a* moment to measure from. Falling back to now is
       * the conservative choice: it can only make a conversion look slower
       * than it was, so the rule under-fires rather than holding someone on
       * the strength of a missing field.
       */
      conversionAt: occurredAt,

      userConversionsInWindow,
      ipConversionsInWindow,
      accountsSharingIp,
      accountsSharingDevice,
      lifetimeConversions,
      lifetimeChargebacks,
    };
  }

  private async countUserConversionsSince(userId: string, since: Date): Promise<number> {
    return this.prisma.conversion.count({
      where: { userId, type: CONVERSION_TYPES.CONVERSION, createdAt: { gte: since } },
    });
  }

  /**
   * Conversions from this click's IP, counted without joining `clicks`.
   *
   * `clicks` hands back the ids it owns and `conversions` counts its own rows
   * against them (DATABASE.md §11.2). One extra round trip, and neither module
   * reads the other's table.
   */
  private async countIpConversionsSince(
    ipAddress: string | null,
    since: Date,
  ): Promise<number | null> {
    // Null, not zero. "No IP recorded" and "an IP with no conversions" are
    // different facts, and only the second is a measurement.
    if (ipAddress === null) return null;

    const clickIds = await this.clicks.findIdsByIpSince(ipAddress, since);

    if (clickIds.length === 0) return 0;

    return this.prisma.conversion.count({
      where: {
        clickId: { in: clickIds },
        type: CONVERSION_TYPES.CONVERSION,
        createdAt: { gte: since },
      },
    });
  }

  private async countLifetimeConversions(userId: string): Promise<number> {
    return this.prisma.conversion.count({
      where: { userId, type: CONVERSION_TYPES.CONVERSION },
    });
  }

  /**
   * Conversions of this user's that were later charged back.
   *
   * Counts originals marked `REVERSED` rather than reversal rows, so that the
   * denominator and the numerator are drawn from the same population — the
   * user's own conversions. Counting reversal rows instead would compare
   * chargebacks against conversions and quietly include reversals that
   * referenced somebody else's event.
   */
  private async countLifetimeChargebacks(userId: string): Promise<number> {
    return this.prisma.conversion.count({
      where: {
        userId,
        type: CONVERSION_TYPES.CONVERSION,
        status: CONVERSION_STATUSES.REVERSED,
      },
    });
  }
}

/**
 * The domain half of an email address, lowercased.
 *
 * Returns null rather than a guess for anything that does not have exactly one
 * `@` — the disposable-domain rule must skip on unparseable input, not compare
 * the blocklist against an empty string and quietly pass.
 */
export function emailDomainOf(email: string): string | null {
  const parts = email.trim().toLowerCase().split('@');

  if (parts.length !== 2) return null;

  const domain = parts[1] ?? '';

  return domain.length > 0 ? domain : null;
}
