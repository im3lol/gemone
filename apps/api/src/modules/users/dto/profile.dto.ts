import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordRequest, UpdateProfileRequest } from '@gemone/contracts';

import { PASSWORD_POLICY } from '../../auth/auth.constants';

export class UpdateProfileDto implements UpdateProfileRequest {
  /**
   * A BCP-47-shaped tag, loosely validated.
   *
   * Strict validation against a registry would reject valid tags the moment
   * one is added, for a field whose worst failure is a page rendering in the
   * wrong language. The length cap is the part that matters — it stops the
   * column being used as arbitrary storage.
   */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$/, {
    message: 'must be a language tag such as "en" or "ar-EG"',
  })
  locale?: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  /**
   * Required even though the caller is already authenticated.
   *
   * An access token proves the session, not the person. Without this, anyone
   * who gets momentary access to an unlocked browser can take the account
   * permanently by changing its password.
   */
  @IsString()
  @MinLength(1, { message: 'is required' })
  @MaxLength(PASSWORD_POLICY.maxLength)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `must be at least ${PASSWORD_POLICY.minLength} characters`,
  })
  @MaxLength(PASSWORD_POLICY.maxLength)
  newPassword!: string;
}
