import type { UserProfile, UserRole, UserStatus } from './auth';

/**
 * Administration contracts.
 *
 * ARCHITECTURE.md §4.3: `admin` is a composition layer, not a domain. These
 * shapes describe how admin screens see existing resources; they do not
 * introduce an admin-only model of a user.
 */

/**
 * Actions recorded in the audit trail.
 *
 * A const object rather than a database enum: the set grows with every
 * feature, and a Postgres enum would make each addition a migration. The
 * compiler still rejects typos at the call site.
 */
export const ADMIN_ACTIONS = {
  USER_STATUS_CHANGED: 'user.status_changed',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_SESSIONS_REVOKED: 'user.sessions_revoked',
  CONFIGURATION_CHANGED: 'configuration.changed',
  PROVIDER_CREATED: 'provider.created',
  PROVIDER_UPDATED: 'provider.updated',
  PROVIDER_ENABLED: 'provider.enabled',
  PROVIDER_DISABLED: 'provider.disabled',
  PROVIDER_HEALTH_RESET: 'provider.health_reset',
  OFFER_ACTIVATED: 'offer.activated',
  OFFER_DEACTIVATED: 'offer.deactivated',
  CATALOG_SYNC_REQUESTED: 'catalog.sync_requested',
  PAYOUT_APPROVED: 'payout.approved',
  PAYOUT_REJECTED: 'payout.rejected',
  PAYOUT_SETTLED: 'payout.settled',
  PAYOUT_FAILED: 'payout.failed',
  /**
   * Reading a payment destination.
   *
   * An action, not a lookup: DATABASE.md §3.5 requires the detail view that
   * exposes where someone's money goes to be audited, so that "who looked at
   * this user's bank details, and when" has an answer.
   */
  PAYOUT_DESTINATION_VIEWED: 'payout.destination_viewed',
  /** A held conversion released; the points mature and become withdrawable. */
  CONVERSION_HOLD_CLEARED: 'conversion.hold_cleared',
  /** A held conversion confirmed as fraud; the credit is reversed. */
  CONVERSION_HOLD_CONFIRMED: 'conversion.hold_confirmed',
} as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS];

/** What an admin sees about a user — the public profile plus operational state. */
export interface AdminUserSummary extends UserProfile {
  emailVerifiedAt: string | null;
  registrationCountry: string | null;
  updatedAt: string;
  /** Sessions that are currently valid. Zero after a suspension. */
  activeSessionCount: number;
}

export interface UpdateUserStatusRequest {
  status: UserStatus;
  /** Mandatory. An unexplained status change is unauditable. */
  reason: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

/** Offset pagination. Cursor pagination is a later concern (P6). */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListUsersQuery {
  status?: UserStatus;
  role?: UserRole;
  /** Case-insensitive substring match on email. */
  email?: string;
  limit?: number;
  offset?: number;
}

// --- Self-service profile -------------------------------------------------

export interface UpdateProfileRequest {
  locale?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
