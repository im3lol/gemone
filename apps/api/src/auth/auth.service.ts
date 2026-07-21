import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, type User } from '@prisma/client';
import { FraudService } from '../fraud/fraud.service';
import { PrismaService } from '../prisma/prisma.service';
import { genReferralCode } from '../referrals/referral-code';
import { ChangePasswordDto, LoginDto, SignupDto, UpdateProfileDto } from './dto';

const SIGNUP_BONUS = 50;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly fraud: FraudService,
  ) {}

  async signup(dto: SignupDto, ip?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);

    // Resolve the inviter from their code (unknown code just falls back to organic).
    const referredById = dto.referralCode
      ? (await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode }, select: { id: true } }))?.id
      : undefined;

    // Create user + wallet + welcome bonus atomically. Retry only on a referralCode
    // collision (the unique backstop); any other error propagates.
    const user = await this.createUser(passwordHash, dto, ip, referredById);

    // Screen after creation — flags for review, never blocks the signup itself.
    await this.fraud.screenSignup({
      userId: user.id,
      email: user.email,
      ip,
      deviceHash: dto.deviceHash,
    });

    return this.buildSession(user);
  }

  private async createUser(passwordHash: string, dto: SignupDto, ip: string | undefined, referredById?: string): Promise<User> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email: dto.email,
              passwordHash,
              displayName: dto.displayName ?? dto.email.split('@')[0],
              signupIp: ip,
              deviceHash: dto.deviceHash,
              referralCode: genReferralCode(),
              referredById,
              wallet: { create: { balance: SIGNUP_BONUS } },
            },
          });
          await tx.ledgerEntry.create({
            data: { userId: created.id, points: SIGNUP_BONUS, type: 'BONUS', reference: 'signup' },
          });
          await tx.activity.create({
            data: { userId: created.id, kind: 'bonus', title: 'Welcome bonus', points: SIGNUP_BONUS },
          });
          return created;
        });
      } catch (e) {
        const collidedOnCode =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String((e.meta as { target?: unknown })?.target).includes('referralCode');
        if (collidedOnCode) continue; // regenerate and retry
        throw e;
      }
    }
    throw new ConflictException('Could not allocate a referral code — please retry');
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.buildSession(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: dto.displayName, country: dto.country?.toUpperCase() },
    });
    return { id: user.id, email: user.email, displayName: user.displayName, level: user.level, xp: user.xp, country: user.country };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await argon2.hash(dto.newPassword);
    // Also clear the refresh token so other sessions are logged out.
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, refreshTokenHash: null } });
    return { ok: true };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');
    const ok = await argon2.verify(user.refreshTokenHash, refreshToken);
    if (!ok) throw new UnauthorizedException('Invalid refresh token');
    return this.buildSession(user);
  }

  private async buildSession(user: User) {
    const payload = { sub: user.id, email: user.email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL', '7d'),
      }),
    ]);
    const refreshTokenHash = await argon2.hash(refreshToken);
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash } });
    return { accessToken, refreshToken, user: this.sanitize(user) };
  }

  private sanitize(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      level: user.level,
      xp: user.xp,
      emailVerified: user.emailVerified,
    };
  }
}
