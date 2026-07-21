/**
 * End-to-end check for milestone 2+3 (offers + postback).
 * Runs against a live API (http://localhost:4000) + the seeded demo user.
 *
 *   pnpm --filter @offerwall/api exec ts-node scripts/postback-check.ts
 *
 * Verifies: offers aggregate from 2 providers, a signed postback credits once,
 * a replay is idempotent, a bad signature is rejected (403), and a reversal debits.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = 'ashley@gemone.dev';
const PASSWORD = 'password123';

// Read provider secrets straight from .env so the script signs exactly as the server verifies.
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

const balance = async (token: string) => (await j('GET', '/dashboard', token)).data.stats.balance as number;

async function main() {
  // 1. login
  const login = await j('POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
  assert.equal(login.status, 201, `login failed: ${JSON.stringify(login.data)}`);
  const token: string = login.data.accessToken;
  assert.ok(token, 'no access token');

  // 2. offers aggregate from both providers
  const offers = (await j('GET', '/offers', token)).data.offers as any[];
  const providers = new Set(offers.map((o) => o.provider));
  assert.ok(providers.has('adgem') && providers.has('cpx'), `expected adgem+cpx, got ${[...providers]}`);
  const adgem = offers.find((o) => o.provider === 'adgem');
  const userId = new URL(adgem.clickUrl).searchParams.get('sub_id')!;
  assert.ok(userId, 'no sub_id in click url');
  console.log(`✓ offers: ${offers.length} across ${[...providers].join(', ')}`);

  const start = await balance(token);
  const tx = `test-${Date.now()}`;
  const amount = 1500;

  // 3. valid AdGem credit
  const verifier = hmac(env.ADGEM_POSTBACK_SECRET, `${userId}:${tx}:${amount}`);
  const credit = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`);
  assert.equal(credit.status, 200, `credit status ${credit.status}`);
  assert.equal(String(credit.data), '1', `expected ack '1', got ${credit.data}`);
  assert.equal(await balance(token), start + amount, 'credit did not add points');
  console.log(`✓ credit: +${amount} (${start} → ${start + amount})`);

  // 4. replay is idempotent
  const replay = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`);
  assert.equal(replay.status, 200, 'replay should be accepted as no-op');
  assert.equal(await balance(token), start + amount, 'replay double-credited!');
  console.log('✓ idempotent: replay did not double-credit');

  // 5. bad signature rejected
  const forged = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}-forged&amount=999999&verifier=deadbeef`);
  assert.equal(forged.status, 403, `forged should be 403, got ${forged.status}`);
  assert.equal(await balance(token), start + amount, 'forged postback changed balance!');
  console.log('✓ security: bad signature → 403, no credit');

  // 6. reversal debits
  const revVerifier = hmac(env.ADGEM_POSTBACK_SECRET, `${userId}:${tx}:${amount}`);
  const reversal = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&status=2&offer_id=raid&verifier=${revVerifier}`);
  assert.equal(reversal.status, 200, `reversal status ${reversal.status}`);
  assert.equal(await balance(token), start, 'reversal did not debit back to start');
  console.log(`✓ reversal: -${amount} (${start + amount} → ${start})`);

  // 7. CPX credit (second provider, different signature scheme)
  const cpxTx = `cpx-${Date.now()}`;
  const cpxHash = hmac(env.CPX_POSTBACK_SECRET, `${userId}-${cpxTx}-800`);
  const cpx = await j('GET', `/postback/cpx?user_id=${userId}&trans_id=${cpxTx}&amount=800&survey_id=quick&hash=${cpxHash}`);
  assert.equal(cpx.status, 200, `cpx status ${cpx.status}`);
  assert.equal(cpx.data, 'OK', `expected ack 'OK', got ${cpx.data}`);
  assert.equal(await balance(token), start + 800, 'cpx credit failed');
  console.log('✓ cpx: +800 via second provider');

  console.log('\nALL CHECKS PASSED ✅');
}

main().catch((e) => {
  console.error('\nCHECK FAILED ❌\n', e);
  process.exit(1);
});
