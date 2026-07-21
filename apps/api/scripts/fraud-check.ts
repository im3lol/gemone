/**
 * Milestone 6 — anti-fraud. Boots the Nest app context (needs Postgres; Redis for
 * the payouts module it pulls in).
 *
 *   pnpm --filter @offerwall/api exec ts-node scripts/fraud-check.ts
 *
 * Proves: duplicate IP/device + VPN flagging at signup, velocity flag, reversal
 * abuse auto-suspend, suspended accounts blocked from withdrawing, and flagged
 * accounts forced into manual review.
 */
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FraudService } from '../src/fraud/fraud.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PrismaService } from '../src/prisma/prisma.service';

const BLOCKED_IP = '203.0.113.66'; // must match FRAUD_BLOCKED_IPS

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const fraud = app.get(FraudService);
  const payouts = app.get(PayoutsService);

  const created: string[] = [];
  let n = 0;
  const mk = async (over: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({
      data: { email: `fraud-${n++}-${Date.now()}@test.local`, passwordHash: 'x', emailVerified: true, ...over },
    });
    created.push(u.id);
    return u;
  };
  const logTypes = async (id: string) => (await prisma.fraudLog.findMany({ where: { userId: id } })).map((l) => l.type);
  const statusOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  // 1. duplicate IP
  const ip = '198.51.100.7';
  const a = await mk({ signupIp: ip });
  const b = await mk({ signupIp: ip });
  const c = await mk({ signupIp: ip });
  await fraud.screenSignup({ userId: c.id, email: c.email, ip });
  assert.ok((await logTypes(c.id)).includes('duplicate_ip'), 'duplicate IP not flagged');
  console.log('✓ duplicate IP: 3rd account on same IP flagged');

  // 2. VPN → FLAGGED
  const v = await mk({ signupIp: BLOCKED_IP });
  await fraud.screenSignup({ userId: v.id, email: v.email, ip: BLOCKED_IP });
  assert.ok((await logTypes(v.id)).includes('vpn'), 'vpn not flagged');
  assert.equal(await statusOf(v.id), 'FLAGGED', 'vpn should flag account');
  console.log('✓ VPN: blocked-IP signup logged + account FLAGGED');

  // 3. duplicate device
  const dev = 'device-abc123';
  const d1 = await mk({ deviceHash: dev });
  const d2 = await mk({ deviceHash: dev });
  await fraud.screenSignup({ userId: d2.id, email: d2.email, deviceHash: dev });
  assert.ok((await logTypes(d2.id)).includes('duplicate_device'), 'duplicate device not flagged');
  console.log('✓ duplicate device: shared fingerprint flagged');

  // 4. velocity → FLAGGED
  const vel = await mk();
  await prisma.activity.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({ userId: vel.id, kind: 'offer', title: `x${i}`, points: 6000 })),
  });
  await fraud.checkVelocity(vel.id);
  assert.ok((await logTypes(vel.id)).includes('velocity'), 'velocity not flagged');
  assert.equal(await statusOf(vel.id), 'FLAGGED', 'velocity should flag account');
  console.log('✓ velocity: 30,000 pts in <10m flagged account');

  // 5. reversal abuse → SUSPENDED
  const rev = await mk();
  await prisma.postbackEvent.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({ provider: 'adgem', transactionId: `rv-${rev.id}-${i}`, type: 'reversal', userId: rev.id, points: 1000 })),
  });
  await fraud.onReversal(rev.id);
  assert.equal(await statusOf(rev.id), 'SUSPENDED', 'reversal abuse should suspend');
  assert.ok((await logTypes(rev.id)).includes('reversal_abuse'), 'reversal_abuse not logged');
  console.log('✓ reversal abuse: 3 reversals → account SUSPENDED');

  // 6. suspended blocked from withdrawing
  await assert.rejects(
    payouts.create(rev.id, { method: 'paypal', destination: 's@paypal.com', points: 5000 }),
    /suspended/i,
    'suspended user was allowed to withdraw',
  );
  console.log('✓ enforcement: suspended account cannot request a withdrawal');

  // 7. flagged account → withdrawal forced to manual review (even when non-first)
  const fl = await mk({ status: 'FLAGGED', wallet: { create: { balance: 30000 } } });
  const w1 = await payouts.create(fl.id, { method: 'paypal', destination: 'f@paypal.com', points: 5000 });
  const w2 = await payouts.create(fl.id, { method: 'paypal', destination: 'f@paypal.com', points: 5000 });
  assert.equal(w1.status, 'PENDING');
  assert.equal(w2.status, 'PENDING', 'flagged account should never auto-clear a payout');
  console.log('✓ enforcement: flagged account payouts forced to manual review');

  // 8. admin view lists flagged/suspended
  const flagged = await fraud.flaggedUsers();
  const ids = new Set(flagged.map((u) => u.id));
  assert.ok(ids.has(v.id) && ids.has(rev.id) && ids.has(fl.id), 'flagged list incomplete');
  console.log(`✓ admin view: ${flagged.length} flagged/suspended accounts listed`);

  // cleanup
  await prisma.postbackEvent.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  console.log('\nALL PHASE 6 CHECKS PASSED ✅');
  await app.close();
}

main().catch(async (e) => {
  console.error('\nCHECK FAILED ❌\n', e);
  process.exit(1);
});
