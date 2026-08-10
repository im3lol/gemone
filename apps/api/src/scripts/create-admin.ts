import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from '../app.module';
import { loadDotenvForDevelopment } from '../core/config/load-dotenv';
import { PrismaService } from '../core/database/prisma.service';
import { PasswordService } from '../modules/auth/password.service';
import { UsersService } from '../modules/users/users.service';

/**
 * Provisions the first admin — ARCHITECTURE.md §8.4.
 *
 * §8.4 forbids admin self-registration and says accounts are provisioned "by a
 * seed script or by an existing admin". This is that seed script, and without
 * it a fresh database has no admin, which means no provider can be registered,
 * no configuration changed, and no payout approved.
 *
 * Idempotent: run it again on an existing address and it promotes that account
 * rather than failing.
 */
export async function provisionAdmin(
  app: INestApplicationContext,
  email: string,
  password: string,
): Promise<{ id: string; created: boolean }> {
  const users = app.get(UsersService);
  const passwords = app.get(PasswordService);
  const prisma = app.get(PrismaService);

  const existing = await users.findByEmail(email);

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    return { id: existing.id, created: false };
  }

  // Through UsersService so the balance row is opened with the account, the
  // same way registration does it.
  const created = await users.create({
    email,
    passwordHash: await passwords.hash(password),
  });

  await prisma.user.update({ where: { id: created.id }, data: { role: 'ADMIN' } });

  return { id: created.id, created: true };
}

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: node dist/scripts/create-admin.js <email> <password>');
    process.exit(1);
  }

  loadDotenvForDevelopment();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const result = await provisionAdmin(app, email, password);
    console.log(
      result.created
        ? `Created admin ${email} (${result.id})`
        : `Promoted existing account ${email} (${result.id}) to ADMIN`,
    );
  } finally {
    await app.close();
  }

  // Explicit: the queue's Redis connections keep the event loop alive, so a
  // CLI that only closed the context would print its result and then hang.
  process.exit(0);
}

// Only when executed directly, so the integration test can import the function.
if (process.argv[1]?.endsWith('create-admin.js')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
