/**
 * End-to-end check for the referral system.
 * Runs against a live API (http://localhost:4000) + the seeded demo data
 * (Ashley invited John & Emma; code ASHLEY24).
 *
 *   pnpm --filter @offerwall/api exec ts-node scripts/referral-check.ts
 *
 * Verifies: /referrals returns the code + invited count + seeded commission;
 * crediting a referred user (John) pays the inviter (Ashley) exactly 10%;
 * crediting a non-referred user (Ashley) pays no self-commission.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:4000';
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1], m[2]]),
);
const hmac = (secret: string, base: string) => createHmac('sha256', secret).update(base).digest('hex');

async function j(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* plain-text ack */ }
  return { status: res.status, data };
}

async function login(email: string, password: string) {
  const res = await j('POST', '/auth/login', undefined, { email, password });
  assert.equal(res.status, 201, `login ${email} failed: ${JSON.stringify(res.data)}`);
  return res.data.accessToken as string;
}

// A user's own id = the sub_id embedded in their offer click urls.
async function selfId(token: string) {
  const offers = (await j('GET', '/offers', token)).data.offers as any[];
  const adgem = offers.find((o) => o.provider === 'adgem');
  return new URL(adgem.clickUrl).searchParams.get('sub_id')!;
}

const commission = async (token: string) => (await j('GET', '/referrals', token)).data.commissionPoints as number;

async function creditAdgem(userId: string, amount: number) {
  const tx = `reftest-${userId}-${Date.now()}`;
  const verifier = hmac(env.ADGEM_POSTBACK_SECRET, `${userId}:${tx}:${amount}`);
  const res = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`);
  assert.equal(res.status, 200, `credit failed: ${res.status} ${JSON.stringify(res.data)}`);
}

async function main() {
  const ashley = await login('ashley@gemone.dev', 'password123');
  const john = await login('john@demo.gemone.dev', 'password123');

  // 1. referral summary
  const summary = (await j('GET', '/referrals', ashley)).data;
  assert.equal(summary.code, 'ASHLEY24', `expected code ASHLEY24, got ${summary.code}`);
  assert.equal(summary.percent, 10, `expected 10%, got ${summary.percent}`);
  assert.ok(summary.invited >= 2, `expected >=2 invited, got ${summary.invited}`);
  console.log(`✓ summary: code=${summary.code} invited=${summary.invited} earned=$${summary.commissionUsd}`);

  // 2. credit a referred user → inviter earns exactly 10%
  const before = await commission(ashley);
  const johnId = await selfId(john);
  await creditAdgem(johnId, 2000);
  const after = await commission(ashley);
  assert.equal(after - before, 200, `expected +200 commission, got +${after - before}`);
  console.log(`✓ commission: John earned 2000 → Ashley +200 (${before} → ${after})`);

  // 3. credit a NON-referred user (Ashley herself has no inviter) → no self-commission
  const ashleyId = await selfId(ashley);
  const noRefBefore = await commission(ashley);
  await creditAdgem(ashleyId, 5000);
  const noRefAfter = await commission(ashley);
  assert.equal(noRefAfter, noRefBefore, `organic credit paid commission (${noRefBefore} → ${noRefAfter})`);
  console.log(`✓ no self-referral: Ashley (organic) earned 5000 → commission unchanged (${noRefAfter})`);

  console.log('\nALL REFERRAL CHECKS PASSED ✅');
}

main().catch((e) => {
  console.error('\nCHECK FAILED ❌\n', e);
  process.exit(1);
});
