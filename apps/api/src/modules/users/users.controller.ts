import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import { ERROR_CODES, type UserProfile } from '@gemone/contracts';

import { DomainError } from '../../core/errors/app-error';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { REVOCATION_REASONS } from '../auth/auth.constants';
import { CurrentUser } from '../auth/decorators';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { UsersService } from './users.service';

/**
 * Self-service account endpoints.
 *
 * The current-user endpoint lives here rather than under `/auth` because it
 * returns a user resource, and the `users` module owns users (DATABASE.md
 * §11). `auth` owns sessions.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * The authenticated user's own profile.
   *
   * Re-read from the database rather than reconstructed from the guard's
   * principal: the guard carries only what authorisation needs, and this is
   * what a client polls after a change to see current state.
   */
  @Get('me')
  async me(@CurrentUser() principal: AuthenticatedUser): Promise<UserProfile> {
    const user = await this.users.findById(principal.id);

    if (!user) {
      // Unreachable while the guard loads the same row, but a 404 is the
      // honest answer if it ever becomes reachable.
      throw new NotFoundException('User not found');
    }

    return UsersService.toProfile(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() principal: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const updated = await this.users.updateProfile(principal.id, { locale: dto.locale });

    return UsersService.toProfile(updated);
  }

  /**
   * Changes the caller's password and ends every session, including this one.
   *
   * Logging the user out everywhere is the point rather than a side effect:
   * the common reason to change a password is suspecting it is compromised,
   * and leaving other sessions alive would leave the attacker logged in. The
   * cost is one re-login for the legitimate user.
   *
   * Returns 204 — the client must authenticate again, so there is nothing
   * useful to return.
   */
  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() principal: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.users.requireById(principal.id);

    const currentMatches = await this.passwords.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!currentMatches) {
      // An access token proves the session, not the person.
      throw new DomainError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Current password is incorrect',
        401,
      );
    }

    // Policy is enforced by the service, for callers that never see a DTO.
    const newHash = await this.passwords.hash(dto.newPassword);

    await this.users.updatePasswordHash(user.id, newHash);
    await this.tokens.revokeAllForUser(user.id, REVOCATION_REASONS.LOGOUT);
  }
}
