import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RewardsModule } from '../rewards/rewards.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Owns the `users` table (DATABASE.md §11).
 *
 * Exports only `UsersService` — no repository, no Prisma delegate. Other
 * modules read user data through this service; nothing else queries the
 * table (ARCHITECTURE.md §5, rule 4).
 *
 * The forwardRef is a genuine cycle, not an accident: `auth` needs
 * `UsersService` to authenticate, and this module's self-service password
 * change needs `PasswordService` and `TokenService`. Both directions are real
 * — a password change IS a session operation — and splitting a third module
 * out to break it would add a layer to satisfy a diagram rather than a
 * problem (P6).
 *
 * The dependency on `rewards` is what keeps DATABASE.md §10.1's registration
 * transaction — create user, then create the balance row — without breaking
 * P2's "only RewardAccountingService writes that table". §4.1's graph does not
 * draw this arrow; it draws the arrows that existed when it was written, and
 * this one exists because the balance must not be created lazily. Recorded in
 * DECISIONS.md (D36). `rewards` depends on no domain module, so nothing cycles.
 */
@Module({
  imports: [forwardRef(() => AuthModule), RewardsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
