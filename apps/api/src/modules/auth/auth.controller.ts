import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ERROR_CODES, type AuthResponse } from '@gemone/contracts';
import type { Request, Response } from 'express';

import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import { DomainError } from '../../core/errors/app-error';
import { AuthService, type AuthResult } from './auth.service';
import { Public } from '../../core/security/public.decorator';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/credentials.dto';
import { PublicThrottleGuard } from './public-throttle.guard';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';
import type { SessionContext } from './token.service';

/**
 * Authentication endpoints.
 *
 * Thin by design (§6.2, step 10): parse, delegate, shape the response. The
 * only logic here is translating between HTTP transport (cookies, headers)
 * and the service's vocabulary — which is exactly a controller's job.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @UseGuards(PublicThrottleGuard)
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(dto.email, dto.password, contextOf(request));
    return this.respondWithSession(response, result);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(dto.email, dto.password, contextOf(request));
    return this.respondWithSession(response, result);
  }

  /**
   * Public because the whole point is that the caller has not proven anything
   * yet — the token in the body is the proof, and it is single-use.
   *
   * 204 rather than the updated profile: the client that posts this is the
   * page behind the emailed link, and it has no session to refresh. A caller
   * that wants the new state asks for it.
   */
  @Public()
  @UseGuards(PublicThrottleGuard)
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(dto.token);
  }

  /**
   * 204 whatever happens — ARCHITECTURE.md §8.3.
   *
   * Not a convenience: the status, the body and the headers must be identical
   * for an address with an account and one without, or this endpoint answers
   * the question the whole login path is built to refuse. The service returns
   * `void` for the same reason, so there is nothing here that *could* differ.
   */
  @Public()
  @UseGuards(PublicThrottleGuard)
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  /**
   * 204, and deliberately not a session.
   *
   * Logging the caller in here would hand a session to whoever holds the
   * token, on the strength of an email that may have been read by someone
   * else. Registration issues a session because the credentials were proven in
   * that request; here they were only just set. The client posts to `/login`
   * with the new password like anyone else.
   */
  @Public()
  @UseGuards(PublicThrottleGuard)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  /**
   * Public because the access token is expected to be expired here — that is
   * the whole reason to call it. The refresh token is the credential, and it
   * is verified against the database by TokenService.
   *
   * **Deliberately not behind `PublicThrottleGuard`**, unlike the other four
   * public endpoints. Nothing but `web` ever calls this: the browser holds a
   * session cookie and the BFF exchanges it here over the internal network
   * (§6.1), so every request arrives from one address. A per-IP request
   * ceiling would therefore be a ceiling on the entire platform — twenty
   * refreshes per window for all users at once — and the failure mode is that
   * everyone is signed out and cannot get back in.
   *
   * What bounds it instead is the credential itself: 256 bits of entropy
   * matched against a hash in `refresh_tokens`, rotated on every use, with
   * reuse revoking the whole family (§8.2). Guessing is not the attack this
   * endpoint has.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body?: { refreshToken?: string },
  ): Promise<AuthResponse> {
    const token = readRefreshToken(request, body);

    if (!token) {
      throw new DomainError(
        ERROR_CODES.AUTH_REFRESH_INVALID,
        'Refresh token is missing',
        401,
      );
    }

    const result = await this.auth.refresh(token, contextOf(request));
    return this.respondWithSession(response, result);
  }

  /**
   * Public and idempotent.
   *
   * Public because logging out must work when the access token has already
   * expired — refusing would leave the refresh token alive precisely when the
   * user is trying to end the session. Idempotent because a client that gets
   * an error from logout learns to ignore logout errors.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body?: { refreshToken?: string },
  ): Promise<void> {
    await this.auth.logout(readRefreshToken(request, body));

    // Cleared unconditionally: the browser must not keep holding a token
    // whether or not the server recognised it.
    clearRefreshCookie(response, this.env);
  }

  private respondWithSession(response: Response, result: AuthResult): AuthResponse {
    setRefreshCookie(
      response,
      this.env,
      result.session.refreshToken,
      result.session.refreshExpiresAt,
    );

    // The refresh token is deliberately absent from the body. It travels only
    // in the httpOnly cookie, so browser JavaScript never holds it.
    return {
      user: result.user,
      accessToken: result.session.accessToken,
      expiresIn: result.session.expiresIn,
      tokenType: 'Bearer',
    };
  }
}

/** Request metadata recorded against the issued session. */
function contextOf(request: Request): SessionContext {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}
