import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@gemone/contracts';

import type { AuthenticatedUser } from './authenticated-user';

/**
 * `@Public()` is NOT re-exported here.
 *
 * It lives in `core/security` because `core/health` needs it and `core` may
 * not import `modules` (§5, rule 2). Re-exporting it from this module would
 * make `import { Public } from '.../modules/auth/decorators'` the obvious
 * choice for anyone in core, recreating the violation through an alias.
 */

export const REQUIRED_ROLES_KEY = 'auth:requiredRoles';

/** Restricts an endpoint to the listed roles. */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

/**
 * Injects the authenticated user into a handler parameter.
 *
 * Reads what `JwtAuthGuard` attached. It cannot be present without the guard
 * having run, so a handler using it can trust it.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user) {
      // Reachable only by putting @CurrentUser() on a @Public() handler.
      // Failing loudly beats handing the handler `undefined` and letting it
      // decide what an anonymous user means.
      throw new Error(
        'CurrentUser used on a route that does not require authentication',
      );
    }

    return request.user;
  },
);
