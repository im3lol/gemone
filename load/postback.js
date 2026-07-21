import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

// Load test for the postback path — the platform's most critical route (money in).
//   k6 run load/postback.js
//   k6 run -e VUS=50 -e DURATION=30s -e API_URL=http://localhost:4000 load/postback.js
const API = __ENV.API_URL || 'http://localhost:4000';
const SECRET = __ENV.ADGEM_SECRET || 'dev-adgem-secret-change-me';

export const options = {
  scenarios: {
    postbacks: {
      executor: 'constant-vus',
      vus: __ENV.VUS ? +__ENV.VUS : 30,
      duration: __ENV.DURATION || '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% non-2xx
    http_req_duration: ['p(95)<500'], // p95 under 500ms
  },
};

// Resolve a real user id (echoed back as sub_id) once, before the load starts.
export function setup() {
  const login = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: 'ashley@gemone.dev', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const token = login.json('accessToken');
  const offers = http.get(`${API}/offers`, { headers: { Authorization: `Bearer ${token}` } });
  const clickUrl = offers.json('offers.0.clickUrl');
  const subId = clickUrl.match(/sub_id=([^&]+)/)[1];
  return { subId };
}

export default function (data) {
  const tx = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const amount = 10;
  const verifier = crypto.hmac('sha256', SECRET, `${data.subId}:${tx}:${amount}`, 'hex');
  const url = `${API}/postback/adgem?sub_id=${data.subId}&transaction_id=${tx}&amount=${amount}&offer_id=raid&offer_name=RAID&verifier=${verifier}`;
  const res = http.get(url);
  check(res, {
    'status 200': (r) => r.status === 200,
    'ack 1': (r) => r.body === '1',
  });
}
