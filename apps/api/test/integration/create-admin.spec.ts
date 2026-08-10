import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { provisionAdmin } from '../../src/scripts/create-admin';

/**
 * The admin bootstrap — ARCHITECTURE.md §8.4.
 *
 * Worth an integration test because it is the only path to an admin account:
 * if it breaks, a fresh deployment has no way to register a provider, change a
 * configuration value, or approve a payout.
 */
describe('admin bootstrap (integration)', () => {
  let app: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let prisma: PrismaService;

  let counter = 0;
  const nextEmail = () => `admin-${++counter}.${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.payoutRequest.deleteMany();
    await prisma.rewardTransaction.deleteMany();
    await prisma.userBalance.deleteMany();
    await prisma.conversion.deleteMany();
    await prisma.fraudEvaluation.deleteMany();
    await prisma.providerPostback.deleteMany();
    await prisma.click.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates an admin with a balance, from nothing', async () => {
    const email = nextEmail();

    const result = await provisionAdmin(app, email, password);

    expect(result.created).toBe(true);

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.role).toBe('ADMIN');

    // Opened with the account, as registration does it — a missing balance is
    // an error path nobody tests.
    expect(await prisma.userBalance.count({ where: { userId: user.id } })).toBe(1);
  });

  it('promotes an existing account instead of failing', async () => {
    // Running the script twice, or against someone who already registered, is
    // the normal case rather than a mistake.
    const email = nextEmail();
    await provisionAdmin(app, email, password);

    const again = await provisionAdmin(app, email, password);

    expect(again.created).toBe(false);
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.role).toBe('ADMIN');
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('sets a password the admin can actually log in with', async () => {
    const email = nextEmail();
    await provisionAdmin(app, email, password);

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
