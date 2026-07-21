"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const API = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = 'ashley@gemone.dev';
const PASSWORD = 'password123';
const env = Object.fromEntries((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter((m) => !!m)
    .map((m) => [m[1], m[2]]));
const hmac = (secret, base) => (0, node_crypto_1.createHmac)('sha256', secret).update(base).digest('hex');
async function j(method, path, token, body) {
    const res = await fetch(API + path, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = text;
    try {
        data = JSON.parse(text);
    }
    catch { }
    return { status: res.status, data };
}
const balance = async (token) => (await j('GET', '/dashboard', token)).data.stats.balance;
async function main() {
    const login = await j('POST', '/auth/login', undefined, { email: EMAIL, password: PASSWORD });
    strict_1.default.equal(login.status, 201, `login failed: ${JSON.stringify(login.data)}`);
    const token = login.data.accessToken;
    strict_1.default.ok(token, 'no access token');
    const offers = (await j('GET', '/offers', token)).data.offers;
    const providers = new Set(offers.map((o) => o.provider));
    strict_1.default.ok(providers.has('adgem') && providers.has('cpx'), `expected adgem+cpx, got ${[...providers]}`);
    const adgem = offers.find((o) => o.provider === 'adgem');
    const userId = new URL(adgem.clickUrl).searchParams.get('sub_id');
    strict_1.default.ok(userId, 'no sub_id in click url');
    console.log(`✓ offers: ${offers.length} across ${[...providers].join(', ')}`);
    const start = await balance(token);
    const tx = `test-${Date.now()}`;
    const amount = 1500;
    const verifier = hmac(env.ADGEM_POSTBACK_SECRET, `${userId}:${tx}:${amount}`);
    const credit = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`);
    strict_1.default.equal(credit.status, 200, `credit status ${credit.status}`);
    strict_1.default.equal(credit.data, '1', `expected ack '1', got ${credit.data}`);
    strict_1.default.equal(await balance(token), start + amount, 'credit did not add points');
    console.log(`✓ credit: +${amount} (${start} → ${start + amount})`);
    const replay = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`);
    strict_1.default.equal(replay.status, 200, 'replay should be accepted as no-op');
    strict_1.default.equal(await balance(token), start + amount, 'replay double-credited!');
    console.log('✓ idempotent: replay did not double-credit');
    const forged = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}-forged&amount=999999&verifier=deadbeef`);
    strict_1.default.equal(forged.status, 403, `forged should be 403, got ${forged.status}`);
    strict_1.default.equal(await balance(token), start + amount, 'forged postback changed balance!');
    console.log('✓ security: bad signature → 403, no credit');
    const revVerifier = hmac(env.ADGEM_POSTBACK_SECRET, `${userId}:${tx}:${amount}`);
    const reversal = await j('GET', `/postback/adgem?sub_id=${userId}&transaction_id=${tx}&amount=${amount}&status=2&offer_id=raid&verifier=${revVerifier}`);
    strict_1.default.equal(reversal.status, 200, `reversal status ${reversal.status}`);
    strict_1.default.equal(await balance(token), start, 'reversal did not debit back to start');
    console.log(`✓ reversal: -${amount} (${start + amount} → ${start})`);
    const cpxTx = `cpx-${Date.now()}`;
    const cpxHash = hmac(env.CPX_POSTBACK_SECRET, `${userId}-${cpxTx}-800`);
    const cpx = await j('GET', `/postback/cpx?user_id=${userId}&trans_id=${cpxTx}&amount=800&survey_id=quick&hash=${cpxHash}`);
    strict_1.default.equal(cpx.status, 200, `cpx status ${cpx.status}`);
    strict_1.default.equal(cpx.data, 'OK', `expected ack 'OK', got ${cpx.data}`);
    strict_1.default.equal(await balance(token), start + 800, 'cpx credit failed');
    console.log('✓ cpx: +800 via second provider');
    console.log('\nALL CHECKS PASSED ✅');
}
main().catch((e) => {
    console.error('\nCHECK FAILED ❌\n', e);
    process.exit(1);
});
//# sourceMappingURL=postback-check.js.map