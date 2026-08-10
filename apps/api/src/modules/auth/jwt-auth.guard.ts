import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@gemone/contracts';
import type { Request } from 'express';

import { DomainError } from '../../core/errors/app-error';
import { UsersService } from '../users/users.service';
import type { AuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from '../../core/security/public.decorator';
import { TokenService } from './token.service';

/**
 * Authenticates every request — ARCHITECTURE.md §6.2, step 7.
 *
 * Registered globally, with `@Public()` to opt out. Endpoints are protected
 * by default because forgetting a guard exposes an endpoint silently, while
 * forgetting `@Public()` produces an immediate, obvious 401.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new DomainError(
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Authentication required',
        401,
      );
    }

    const claims = this.tokens.verifyAccessToken(token);

    /*
     * The user is loaded on every request rather than trusted from the token.
     *
     * ARCHITECTURE.md §8.3 requires suspension to be "checked in the auth
     * guard on every request, not only at login". A JWT cannot be revoked, so
     * without this lookup a suspended user keeps full access until their
     * access token expires — and on a platform holding withdrawable balances,
     * the window between suspending an account and it taking effect is the
     * window in which fraud is cashed out.
     *
     * This costs one indexed primary-key read per request. §14.2 forbids
     * caching authorisation decisions for exactly this reason.
     */
    const user = await this.users.findById(claims.sub);

    if (!user) {
      throw new DomainError(
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Authentication required',
        401,
      );
    }

    if (!UsersService.isActive(user)) {
      throw new DomainError(
        ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
        'This account is not active',
        403,
      );
    }

    const principal: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    (request as Request & { user?: AuthenticatedUser }).user = principal;

    return true;
  }
}

/**
 * Reads `Authorization: Bearer <token>`.
 *
 * The BFF holds the access token server-side and sends it as a bearer header
 * (§6.1); the browser never has it. Only the refresh token travels as a
 * cookie, and only to `/auth`.
 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

  return value.trim() || null;
}

export const __testing = { extractBearerToken };
