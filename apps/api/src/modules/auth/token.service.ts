import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, type UserRole } from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import { REVOCATION_REASONS } from './auth.constants';

/** Claims carried by an access token. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  role: UserRole;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Request metadata recorded against an issued refresh token. */
export interface SessionContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Session token issuance, rotation and revocation — ARCHITECTURE.md §8.1–8.2.
 *
 * Two token types with deliberately different designs:
 *
 *   Access  — a signed JWT, short-lived, verified without a database round
 *             trip. Cannot be revoked, which is why it is short-lived.
 *   Refresh — an opaque random string, stored only as a hash, long-lived.
 *             Must be revocable on logout, password change or suspension,
 *             and a stateless JWT cannot be revoked.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Hashes a refresh token for storage.
   *
   * SHA-256, not argon2 — and that is not an oversight. Argon2 exists to make
   * guessing *low-entropy* secrets expensive; a 256-bit random token cannot
   * be guessed at all, so the slow hash buys nothing. It would also make
   * lookup impossible: argon2 salts each hash, so there would be nothing to
   * query by, and every refresh would have to scan and verify every stored
   * token. Deterministic hashing is a requirement here, not a shortcut.
   */
  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(userId: string, role: UserRole): string {
    const claims: AccessTokenClaims = { sub: userId, role };
    return this.jwt.sign(claims, { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS });
  }

  /** Verifies an access token, or throws a domain error the filter can map. */
  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      return this.jwt.verify<AccessTokenClaims>(token);
    } catch {
      // The library distinguishes expired from malformed; the client does not
      // need to. Both mean "get a new one", and the distinction leaks whether
      // a token was ever valid.
      throw new DomainError(
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Access token is invalid or expired',
        401,
      );
    }
  }

  /**
   * Starts a new session. Each login opens its own token family, so revoking
   * one compromised session does not log the user out everywhere.
   */
  async issueSession(
    userId: string,
    role: UserRole,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    return this.issueInFamily(userId, role, uuidv7(), context);
  }

  /**
   * Exchanges a refresh token for a new pair, rotating it.
   *
   * Reuse detection (§8.2): presenting a token that has already been used
   * means either a stolen token being replayed or a race between browser
   * tabs. Both are handled correctly by revoking the whole family and forcing
   * a fresh login — the cost is an occasional forced login, the benefit is
   * that a stolen refresh token has a bounded useful life on a platform
   * holding withdrawable balances.
   */
  async rotate(
    presentedToken: string,
    context: SessionContext = {},
  ): Promise<{ userId: string; session: IssuedSession }> {
    const tokenHash = TokenService.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw invalidRefresh();
    }

    if (stored.usedAt !== null) {
      await this.revokeFamily(stored.familyId, REVOCATION_REASONS.REUSE_DETECTED);
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'Refresh token reuse detected — family revoked',
      );
      throw invalidRefresh();
    }

    if (stored.revokedAt !== null || stored.expiresAt.getTime() <= this.clock.nowMs()) {
      throw invalidRefresh();
    }

    if (stored.user.status !== 'ACTIVE') {
      // A suspension applied mid-session must not be extendable by refreshing.
      await this.revokeAllForUser(stored.userId, REVOCATION_REASONS.REUSE_DETECTED);
      throw new DomainError(
        ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
        'This account is not active',
        403,
      );
    }

    // Mark spent and issue the replacement atomically. Without one
    // transaction, a crash between the two leaves a session whose old token
    // is spent and whose new token was never persisted — the user is silently
    // logged out with no way to tell why.
    const session = await this.prisma.$transaction(async (tx) => {
      const spentAt = this.clock.now();
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: {
          usedAt: spentAt,
          revokedAt: spentAt,
          revokedReason: REVOCATION_REASONS.ROTATED,
        },
      });

      return this.issueInFamily(
        stored.userId,
        stored.user.role,
        stored.familyId,
        context,
        tx,
      );
    });

    return { userId: stored.userId, session };
  }

  /**
   * Ends one session. Idempotent: logging out twice, or with a token that was
   * already revoked, is a success — the caller's intent is satisfied either
   * way, and reporting an error teaches clients to ignore logout failures.
   */
  async revokeByToken(presentedToken: string): Promise<void> {
    const tokenHash = TokenService.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt !== null) return;

    // Revokes the family, not just this token: a logout that leaves the rest
    // of the rotation chain usable has not ended the session.
    await this.revokeFamily(stored.familyId, REVOCATION_REASONS.LOGOUT);
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  /**
   * Ends every session a user holds.
   *
   * Accepts a transaction client so an administrative action can revoke
   * sessions in the same transaction as the status change that motivated it
   * (DATABASE.md §10.1). Returns the count so the caller can record it.
   *
   * This exists so that `admin` never queries `refresh_tokens` itself —
   * `auth` owns that table (DATABASE.md §11.1).
   */
  async revokeAllForUser(
    userId: string,
    reason: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const result = await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });

    return result.count;
  }

  /**
   * Counts currently valid sessions per user, in one grouped query.
   *
   * "Not revoked" alone is not a session: a spent token has been rotated away
   * and an expired one has lapsed. Showing an admin three active sessions for
   * a user whose tokens all expired months ago is worse than showing nothing.
   */
  async countActiveSessions(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const groups = await this.prisma.refreshToken.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        revokedAt: null,
        usedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      _count: { _all: true },
    });

    return new Map(groups.map((group) => [group.userId, group._count._all]));
  }

  private async issueInFamily(
    userId: string,
    role: UserRole,
    familyId: string,
    context: SessionContext,
    client: Pick<PrismaService, 'refreshToken'> = this.prisma,
  ): Promise<IssuedSession> {
    // 256 bits of entropy. The token is returned to the caller exactly once
    // and never stored in recoverable form.
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      this.clock.nowMs() + this.env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await client.refreshToken.create({
      data: {
        id: uuidv7(),
        userId,
        familyId,
        tokenHash: TokenService.hashToken(refreshToken),
        expiresAt,
        issuedIp: context.ip ?? null,
        issuedUserAgent: context.userAgent?.slice(0, 512) ?? null,
      },
    });

    return {
      accessToken: this.signAccessToken(userId, role),
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  /** Exposed for tests that need to assert on stored state. */
  static hashForLookup(token: string): string {
    return TokenService.hashToken(token);
  }
}

function invalidRefresh(): DomainError {
  // One error for unknown, expired, spent and revoked tokens. Distinguishing
  // them tells an attacker holding a stolen token which of those it is.
  return new DomainError(
    ERROR_CODES.AUTH_REFRESH_INVALID,
    'Refresh token is invalid or expired',
    401,
  );
}
