import type { UserRole, UserStatus } from '@gemone/contracts';

/**
 * The authenticated principal attached to a request by `JwtAuthGuard`.
 *
 * Deliberately not the full user row. A handler that needs more should ask
 * `UsersService`; passing the whole record around invites a controller to
 * serialise it and leak the password hash.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}
