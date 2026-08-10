import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@gemone/contracts';

import { PASSWORD_POLICY } from '../auth.constants';

/**
 * Validated at the boundary — ARCHITECTURE.md §6.2, step 9.
 *
 * The global ValidationPipe rejects unknown properties outright rather than
 * stripping them silently, so a client sending a field it believes is doing
 * something finds out immediately.
 *
 * Password rules are duplicated between here and PasswordService on purpose:
 * this layer produces a helpful 422 with field detail, while the service
 * enforces the rule for every caller including ones that never see a DTO.
 * The service is the authority; this is the error message.
 */
export class RegisterDto implements RegisterRequest {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254, { message: 'must be at most 254 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `must be at least ${PASSWORD_POLICY.minLength} characters`,
  })
  @MaxLength(PASSWORD_POLICY.maxLength, {
    message: `must be at most ${PASSWORD_POLICY.maxLength} characters`,
  })
  password!: string;
}

/**
 * Login deliberately does NOT enforce the password policy.
 *
 * Tightening the policy must not lock out users whose existing password no
 * longer satisfies it — they should be able to log in and be asked to change
 * it, not be told their own password is invalid.
 */
export class LoginDto implements LoginRequest {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @IsString()
  @MinLength(1, { message: 'is required' })
  @MaxLength(PASSWORD_POLICY.maxLength)
  password!: string;
}

/**
 * The token from a verification link.
 *
 * Bounded, because it is a lookup key: the value is hashed and compared, so a
 * megabyte of input would be a megabyte hashed per request. The real token is
 * 32 random bytes as base64url — 43 characters — and the ceiling is generous
 * enough to survive a change of encoding without being an open door.
 */
export class VerifyEmailDto implements VerifyEmailRequest {
  @IsString()
  @MinLength(1, { message: 'is required' })
  @MaxLength(512)
  token!: string;
}

/**
 * Asking for a reset link.
 *
 * Validated exactly like a login address and no more strictly. A malformed
 * address is rejected because nothing can be sent to it; a well-formed one
 * with no account is not this layer's business, and the service is careful to
 * answer it identically.
 */
export class ForgotPasswordDto implements ForgotPasswordRequest {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;
}

/**
 * Spending a reset link.
 *
 * The password **is** policy-checked here, unlike login's: this is where a new
 * password is chosen, and the reason login stays lenient — not locking out
 * users whose existing password predates a stricter rule — does not apply to
 * one being set now.
 */
export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @MinLength(1, { message: 'is required' })
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `must be at least ${PASSWORD_POLICY.minLength} characters`,
  })
  @MaxLength(PASSWORD_POLICY.maxLength, {
    message: `must be at most ${PASSWORD_POLICY.maxLength} characters`,
  })
  password!: string;
}
