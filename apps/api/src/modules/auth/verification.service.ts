import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type { VerificationTokenPurpose } from '../../generated/prisma/client';
import {
  AUTH_EMAIL_VERIFICATION_TTL_SECONDS,
  AUTH_PASSWORD_RESET_TTL_SECONDS,
} from './auth.config';

/**
 * Single-use, expiring verification tokens — ARCHITECTURE.md §8.3.
 *
 * ## The token is random, and only its hash is stored
 *
 * The same construction `TokenService` uses for refresh tokens, and it matters
 * more here: this value travels through an email, which means it lands in the
 * recipient's mailbox, in whatever logs the delivery path keeps, and — once
 * clicked — in browser history and in any proxy between the two. Storing the
 * hash means none of those copies is worth stealing after the token is spent.
 *
 * ## Consumption is one conditional update, not read-then-write
 *
 * The `usedAt IS NULL` filter is part of the `UPDATE`, so two clicks on the
 * same link race in Postgres rather than in this process: one updates a row,
 * the other updates none. Reading the row and then marking it used would let
 * both pass the check — the same shape of defect the login throttle was fixed
 * for, and email links are clicked twice routinely, by users and by the link
 * scanners in mail clients.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Issues an address-verification token and returns the plaintext.
   *
   * The plaintext is returned rather than stored, because this is the only
   * moment it exists — the caller must hand it to delivery now or it is gone.
   */
  async issueEmailVerification(userId: string): Promise<string> {
    return this.issue(userId, 'EMAIL_VERIFICATION', AUTH_EMAIL_VERIFICATION_TTL_SECONDS.key);
  }

  /**
   * Issues a password-reset token and returns the plaintext.
   *
   * Previously issued reset tokens are left alone. Invalidating them here
   * would mean a second request — a user who clicks "forgot password" twice
   * because the first email was slow — silently breaking the link they are
   * about to receive, or the one they already opened. Each token is single-use
   * and short-lived on its own, so several outstanding at once is a mild
   * widening of a window that closes by itself.
   */
  async issuePasswordReset(userId: string): Promise<string> {
    return this.issue(userId, 'PASSWORD_RESET', AUTH_PASSWORD_RESET_TTL_SECONDS.key);
  }

  /**
   * Spends a token and marks the address verified.
   *
   * One error for "no such token", "already used" and "expired". Telling them
   * apart would answer questions about tokens the caller does not hold, and
   * there is nothing a legitimate user does differently on learning which of
   * the three it was.
   */
  async confirmEmail(presentedToken: string): Promise<void> {
    const now = this.clock.now();
    const userId = await this.consume(presentedToken, 'EMAIL_VERIFICATION', now);

    /*
     * Only when it is not already set. A second verification would move the
     * timestamp forward and lose when the address was actually proven — and
     * the timestamp is the answer to "since when has this been a real
     * address", which is a question fraud review asks.
     */
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });

    this.logger.log({ userId }, 'Email address verified');
  }

  /**
   * Spends a password-reset token and returns whose it was.
   *
   * Takes a transaction client, because the caller must set the new password
   * and revoke the sessions in the same transaction that spends the token
   * (DATABASE.md §10.1). Committing the spend on its own would let a crash
   * consume the only link the user has without changing anything it was
   * supposed to change.
   */
  async consumePasswordReset(
    presentedToken: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    return this.consume(presentedToken, 'PASSWORD_RESET', this.clock.now(), client);
  }

  private async issue(
    userId: string,
    purpose: VerificationTokenPurpose,
    ttlKey: string,
  ): Promise<string> {
    const ttlSeconds = await this.configuration.get<number>(ttlKey);

    const token = randomBytes(32).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        id: uuidv7(),
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(this.clock.now().getTime() + ttlSeconds * 1000),
      },
    });

    return token;
  }

  /**
   * Marks a token used and returns its owner, or throws.
   *
   * The `usedAt IS NULL` filter is part of the `UPDATE` — see the class
   * comment. The purpose is part of it too, so a verification token cannot be
   * presented to a reset endpoint: they are the same shape, drawn from the
   * same alphabet, and only this predicate keeps the cheaper one from
   * unlocking the more valuable one.
   */
  private async consume(
    presentedToken: string,
    purpose: VerificationTokenPurpose,
    now: Date,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const tokenHash = hashToken(presentedToken);

    const { count } = await client.verificationToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (count === 0) throw invalidToken();

    const token = await client.verificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });

    // Unreachable: the update above matched a row, and nothing deletes one.
    // Treated as an error rather than asserted, so a future retention job
    // cannot turn it into a crash on a path users reach.
    if (!token) throw invalidToken();

    return token.userId;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invalidToken(): DomainError {
  return new DomainError(
    ERROR_CODES.AUTH_TOKEN_INVALID,
    'This verification link is invalid or has expired',
    400,
  );
}
