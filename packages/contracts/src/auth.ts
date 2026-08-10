/**
 * Authentication contracts — the API's public vocabulary for identity.
 *
 * ARCHITECTURE.md §8.0: email and password only. No OAuth, no social login,
 * no magic links. Session issuance is independent of how identity was
 * established, so adding a provider later touches none of these shapes.
 */

/** DATABASE.md §3.1 — a closed enum, not a permissions table. */
export const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  CLOSED: 'CLOSED',
} as const;

export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

/**
 * A user as the API returns it.
 *
 * Never contains the password hash, the TOTP secret, or the registration IP.
 * Responses are shaped by explicit serialisers precisely so that adding a
 * column to the table does not silently add it to the API (§19.3).
 */
export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  locale: string;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * What a successful login/register/refresh returns.
 *
 * The access token is in the body because the BFF holds it server-side
 * (§6.1). The refresh token is NOT here — it is set as an httpOnly cookie the
 * browser's JavaScript cannot read, which is the entire point of the design.
 */
export interface AuthTokens {
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResponse extends AuthTokens {
  user: UserProfile;
}

/**
 * The token from a verification link — ARCHITECTURE.md §8.3.
 *
 * Sent in a body rather than read from a query string, so it does not land in
 * access logs, `Referer` headers, or browser history. The link in the email
 * points at a page; the page posts this.
 */
export interface VerifyEmailRequest {
  token: string;
}

/**
 * Asking for a reset link — ARCHITECTURE.md §8.3.
 *
 * There is no response shape because there is no response: the endpoint
 * answers identically whether or not the address has an account. A body that
 * said "sent" or "unknown address" would be an enumeration oracle with a
 * friendly message attached.
 */
export interface ForgotPasswordRequest {
  email: string;
}

/**
 * Spending a reset token.
 *
 * The token and the new password arrive together, in one request. Splitting
 * them — validate the token, then accept a password — would mean either
 * holding server state between the two calls or trusting the client to bring
 * the token back, and the second is just this request with extra steps.
 */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}
