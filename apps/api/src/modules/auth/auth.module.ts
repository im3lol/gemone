import { Module, forwardRef, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';

import { ConfigurationService } from '../../core/config/configuration.service';
import { ENV } from '../../core/config/env.module';
import type { Env } from '../../core/config/env.schema';
import { UsersModule } from '../users/users.module';
import { AUTH_CONFIGURATION_KEYS } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LOGIN_THROTTLE_REDIS } from './auth.tokens';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { PublicThrottleGuard } from './public-throttle.guard';
import { PublicThrottleService } from './public-throttle.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';

/**
 * Owns `refresh_tokens` and the session lifecycle (DATABASE.md §11).
 *
 * Depends on `users` (ARCHITECTURE.md §4.1). The arrow points this way and
 * not back: users know nothing about sessions.
 */
@Module({
  imports: [
    forwardRef(() => UsersModule),
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: {
          // HS256: one service signs, one service verifies. Asymmetric keys
          // solve key distribution across trust boundaries we do not have
          // (§8.1). Set explicitly rather than relying on a library default,
          // because "none" being accepted is a classic JWT vulnerability.
          algorithm: 'HS256',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    LoginThrottleService,
    PublicThrottleService,
    PublicThrottleGuard,
    VerificationService,

    {
      provide: LOGIN_THROTTLE_REDIS,
      inject: [ENV],
      useFactory: (env: Env): Redis =>
        new Redis(env.REDIS_URL, {
          /*
           * Fail fast, because the caller fails closed.
           *
           * With the offline queue enabled, a counter read issued while Redis
           * is unreachable waits in memory instead of erroring — so a login
           * would hang until a socket timeout rather than being refused. The
           * control's whole value is answering quickly and in the safe
           * direction.
           */
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'gemone:login-throttle',
        }),
    },

    /*
     * Global guards, in order (§6.2 steps 7–8).
     *
     * Every endpoint requires authentication unless it declares @Public().
     * The alternative — applying the guard per route — fails silently when
     * someone forgets, and a silently unauthenticated endpoint on a platform
     * holding balances is not a defect anyone finds in review.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule implements OnApplicationBootstrap {
  constructor(private readonly configuration: ConfigurationService) {}

  /**
   * Registers this module's configuration keys.
   *
   * Declared by the module that owns the rule (§4.9), at startup, so a value
   * can never be written for a key nothing reads — and so the admin
   * configuration screen lists the login thresholds without a registry of
   * registries.
   */
  onApplicationBootstrap(): void {
    for (const definition of AUTH_CONFIGURATION_KEYS) {
      this.configuration.register(definition);
    }
  }
}
