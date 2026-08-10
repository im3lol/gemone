import { SetMetadata } from '@nestjs/common';

/**
 * Marks an endpoint as not requiring authentication.
 *
 * Lives in `core/security` rather than in `modules/auth` on purpose.
 * `core/health` needs to declare its endpoints public — Docker's health check
 * and the uptime monitor hold no credentials — and `core` may never import
 * `modules` (ARCHITECTURE.md §5, rule 2). Rather than work around the rule,
 * the dependency is inverted exactly as that rule prescribes: the *marker* is
 * core vocabulary, the *enforcement* stays in `modules/auth`, which reads this
 * key from its guard.
 *
 * Authentication is global and endpoints opt OUT. The failure modes are not
 * symmetric: forgetting to protect an endpoint exposes it silently, while
 * forgetting to mark one public produces a 401 on the first request.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
