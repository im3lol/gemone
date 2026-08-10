import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type UserRole } from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import type { AuthenticatedUser } from './authenticated-user';
import { REQUIRED_ROLES_KEY } from './decorators';

/**
 * Coarse role checks — ARCHITECTURE.md §6.2, step 8.
 *
 * Guards answer "may this KIND of user reach this endpoint". They do NOT
 * answer "does this user own this resource" — that is checked inside the
 * service, because only the service knows the resource. A guard that loads
 * domain objects to authorise them has become a service with the wrong name
 * (§6.2).
 *
 * Runs after JwtAuthGuard, so `request.user` is populated for any route that
 * declares required roles.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      // Only reachable by combining @Roles() with @Public(), which is a
      // contradiction. Denying is the safe reading of a contradictory
      // declaration.
      throw new DomainError(
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Authentication required',
        401,
      );
    }

    if (!required.includes(user.role)) {
      throw new DomainError(
        ERROR_CODES.FORBIDDEN,
        'You do not have access to this resource',
        403,
      );
    }

    return true;
  }
}
