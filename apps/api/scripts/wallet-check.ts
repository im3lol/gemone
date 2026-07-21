/**
 * Milestone 4 — wallet hardening checks. Boots the Nest app context (no HTTP
 * server needed) and drives the real services against the live DB.
 *
 *   pnpm --filter @offerwall/api exec ts-node scripts/wallet-check.ts
 *
 * Proves: concurrent credits are correct (atomic increment), the idempotency key
 * holds under a concurrent replay storm, the ledger↔balance invariant is exact,
 * reconciliation detects injected drift, and a reversal past zero leaves a
 * consistent (negative = debt) ledger.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PostbackService } from '../src/postback/postback.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReconciliationService } from '../src/wallet/reconciliation.service';

const hmac = (secret: string, base: string) => createHmac('sha256', secret).update(base).digest('hex');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const postback = app.get(PostbackService);
  const recon = app.get(ReconciliationService);
  const secret = app.get(ConfigService).getOrThrow<string>('ADGEM_POSTBACK_SECRET');

  const adgem = (sub: string, tx: string, amt: number, status?: string) => ({
    sub_id: sub,
    transaction_id: tx,
    amount: String(amt),
    offer_id: 'raid',
    offer_name: 'RAID',
    ...(status ? { status } : {}),
    verifier: hmac(secret, `${sub}:${tx}:${amt}`),
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: 'ashley@gemone.dev' },
    include: { wallet: true },
  });
  const uid = user.id;
  const start = user.wallet!.balance;
  const balOf = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } })).balance;

  const N = 100;
  const amt = 10;

  // 1. 100 concurrent DISTINCT credits → every one lands exactly once.
  const run = Date.now();
  await Promise.all(
    Array.from({ length: N }, (_, i) => postback.handle('adgem', adgem(uid, `d-${run}-${i}`, amt))),
  );
  assert.equal(await balOf(), start + N * amt, 'distinct concurrency lost/duplicated credits');
  console.log(`✓ concurrency: ${N} parallel distinct credits → +${N * amt} (exact)`);

  // 2. 100 concurrent IDENTICAL credits (same tx) → the idempotency key admits one.
  const dupTx = `idem-${run}`;
  const outcomes = await Promise.all(
    Array.from({ length: N }, () => postback.handle('adgem', adgem(uid, dupTx, amt)).then((r) => r.status)),
  );
  const credited = outcomes.filter((s) => s === 'credited').length;
  assert.equal(credited, 1, `replay storm credited ${credited} times, expected 1`);
  assert.equal(await balOf(), start + N * amt + amt, 'idempotent replay changed balance by != one credit');
  console.log(`✓ idempotency under race: ${N} identical → 1 credited, ${N - 1} duplicate`);

  // 3. ledger↔balance invariant is exact.
  const r1 = await recon.reconcileUser(uid);
  assert.equal(r1.drift, 0, `invariant broken: balance ${r1.balance} != ledger ${r1.ledgerSum}`);
  console.log(`✓ invariant: balance == ledgerSum (${r1.balance})`);

  // 4. reconciliation detects drift injected out-of-band.
  await prisma.wallet.update({ where: { userId: uid }, data: { balance: { increment: 777 } } });
  const r2 = await recon.reconcileUser(uid);
  assert.equal(r2.drift, 777, `drift not detected (got ${r2.drift})`);
  assert.ok((await recon.reconcileAll()).some((d) => d.userId === uid), 'reconcileAll missed the drift');
  await prisma.wallet.update({ where: { userId: uid }, data: { balance: { decrement: 777 } } }); // heal
  assert.equal((await recon.reconcileUser(uid)).drift, 0, 'heal failed');
  console.log('✓ reconciliation: injected drift of 777 detected, then healed');

  // 5. reversal past zero → debt (negative balance) with a consistent ledger.
  const throwaway = await prisma.user.create({
    data: {
      email: `debt-${run}@test.local`,
      passwordHash: 'x',
      wallet: { create: { balance: 50 } },
      ledger: { create: { points: 50, type: 'BONUS', reference: 'signup' } },
    },
  });
  const rev = await postback.handle('adgem', adgem(throwaway.id, `rev-${run}`, 1000, '2'));
  assert.equal(rev.status, 'reversed', `expected reversed, got ${rev.status}`);
  const debtWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: throwaway.id } });
  assert.equal(debtWallet.balance, 50 - 1000, `debt balance wrong: ${debtWallet.balance}`);
  const rd = await recon.reconcileUser(throwaway.id);
  assert.equal(rd.drift, 0, `negative-balance ledger inconsistent (drift ${rd.drift})`);
  assert.ok(rd.balance < 0, 'expected negative balance (debt)');
  await prisma.user.delete({ where: { id: throwaway.id } });
  console.log(`✓ debt: reversal past zero → balance ${debtWallet.balance}, ledger still consistent`);

  console.log('\nALL PHASE 4 CHECKS PASSED ✅');
  await app.close();
}

main().catch(async (e) => {
  console.error('\nCHECK FAILED ❌\n', e);
  process.exit(1);
});
