/**
 * Milestone 5 — withdrawals/payouts. Boots the Nest app context so the BullMQ
 * payout worker runs in-process (needs Redis + Postgres up).
 *
 *   pnpm --filter @offerwall/api exec ts-node scripts/payout-check.ts
 *
 * Proves: points debit atomically at request time, min/insufficient are rejected,
 * first request holds for review then pays via the worker, subsequent small ones
 * auto-clear, admin reject refunds, a permanent provider failure refunds, and the
 * ledger stays consistent throughout.
 */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReconciliationService } from '../src/wallet/reconciliation.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const payouts = app.get(PayoutsService);
  const recon = app.get(ReconciliationService);

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@gemone.dev' } });
  const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'ashley@gemone.dev' }, include: { wallet: true } });
  const uid = demo.id;
  const balOf = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance;
  const statusOf = async (id: string) => (await prisma.withdrawal.findUniqueOrThrow({ where: { id } })).status;

  const waitFor = async (id: string, wanted: string[], ms = 10_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (wanted.includes(await statusOf(id))) return statusOf(id);
      await sleep(150);
    }
    throw new Error(`withdrawal ${id} never reached ${wanted} (stuck at ${await statusOf(id)})`);
  };

  const start = await balOf(uid);

  // 1. validation: below minimum + insufficient balance, no balance change.
  await assert.rejects(payouts.create(uid, { method: 'paypal', destination: 'a@paypal.com', points: 100 }), /Minimum/);
  await assert.rejects(payouts.create(uid, { method: 'paypal', destination: 'a@paypal.com', points: start + 1 }), /Insufficient/);
  assert.equal(await balOf(uid), start, 'rejected validations must not move balance');
  console.log('✓ validation: below-min and insufficient rejected, balance untouched');

  // 2. first request → manual review, points debited immediately.
  const w1 = await payouts.create(uid, { method: 'paypal', destination: 'ashley@paypal.com', points: 5000 });
  assert.equal(w1.status, 'PENDING', 'first withdrawal should hold for review');
  assert.equal(await balOf(uid), start - 5000, 'points not debited at request time');
  console.log('✓ atomic debit: first request PENDING, balance -5000 immediately');

  // 3. admin approves → worker pays → PAID (still debited).
  await payouts.approve(w1.id, admin.id);
  await waitFor(w1.id, ['PAID']);
  const paid1 = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w1.id } });
  assert.ok(paid1.providerRef, 'PAID withdrawal missing provider ref');
  assert.equal(await balOf(uid), start - 5000, 'paid withdrawal must stay debited');
  console.log(`✓ approve→pay: worker paid via provider (ref ${paid1.providerRef})`);

  // 4. second small request → auto-approved → paid, no manual step.
  const w2 = await payouts.create(uid, { method: 'amazon', destination: 'ashley@gift.com', points: 5000 });
  assert.equal(w2.status, 'APPROVED', 'non-first small withdrawal should auto-clear');
  await waitFor(w2.id, ['PAID']);
  assert.equal(await balOf(uid), start - 10000, 'balance after two payouts wrong');
  console.log('✓ auto-clear: second request skipped review and paid');

  // 5+6 use a throwaway user so we control PENDING/failure states.
  const t = await prisma.user.create({
    data: {
      email: `payout-${Date.now()}@test.local`,
      passwordHash: 'x',
      emailVerified: true,
      wallet: { create: { balance: 20000 } },
      ledger: { create: { points: 20000, type: 'BONUS', reference: 'seed' } },
    },
  });

  // 5. reject refunds the held points, idempotently.
  const wr = await payouts.create(t.id, { method: 'paypal', destination: 't@paypal.com', points: 5000 });
  assert.equal(await balOf(t.id), 15000, 'reject test: debit missing');
  await payouts.reject(wr.id, admin.id);
  assert.equal(await statusOf(wr.id), 'REJECTED');
  assert.equal(await balOf(t.id), 20000, 'reject did not refund');
  await assert.rejects(payouts.reject(wr.id, admin.id), /cannot be rejected/);
  assert.equal(await balOf(t.id), 20000, 'double reject double-refunded!');
  console.log('✓ reject: points refunded once, re-reject blocked (idempotent)');

  // 6. permanent provider failure → FAILED + refund.
  const wf = await payouts.create(t.id, { method: 'paypal', destination: 'fail@paypal.com', points: 5000 });
  await waitFor(wf.id, ['FAILED']);
  assert.equal(await balOf(t.id), 20000, 'failed payout not refunded');
  console.log('✓ failure: permanent provider error → FAILED + points refunded');

  // 7. ledger invariant intact for both users.
  for (const id of [uid, t.id]) {
    assert.equal((await recon.reconcileUser(id)).drift, 0, `ledger drift for ${id}`);
  }
  console.log('✓ invariant: balance == ledgerSum after all payout activity');

  await prisma.user.delete({ where: { id: t.id } });
  console.log('\nALL PHASE 5 CHECKS PASSED ✅');
  await app.close();
}

main().catch(async (e) => {
  console.error('\nCHECK FAILED ❌\n', e);
  process.exit(1);
});
