import { PrismaClient, type LedgerType, type WithdrawalStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'ashley@gemone.dev';
const DEMO_PASSWORD = 'password123';
const ADMIN_EMAIL = 'admin@gemone.dev';
const ADMIN_PASSWORD = 'admin12345';

const now = Date.now();
const DAY = 86_400_000;
const ago = (d: number) => new Date(now - d * DAY);

// The five recognizable offers used for the "Offer Performance" panel.
const OFFERS = ['RAID: Shadow Legends', 'MONOPOLY GO!', 'Coin Master', 'TikTok', 'Cash App'];

type Entry = { points: number; type: LedgerType; reference?: string; day?: number };
type Wd = { points: number; method: string; destination: string; status: WithdrawalStatus; day: number };

// Balance is always the exact sum of the ledger, so reconciliation stays clean.
async function makeUser(opts: {
  email: string;
  name: string;
  country?: string;
  status?: 'ACTIVE' | 'FLAGGED' | 'SUSPENDED';
  referralCode?: string;
  referredById?: string;
  entries: Entry[];
  withdrawals?: Wd[];
  offerActivities?: number;
}) {
  const balance = opts.entries.reduce((s, e) => s + e.points, 0);
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: await argon2.hash('password123'),
      displayName: opts.name,
      emailVerified: true,
      country: opts.country,
      status: opts.status ?? 'ACTIVE',
      referralCode: opts.referralCode,
      referredById: opts.referredById,
      signupIp: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      wallet: { create: { balance } },
      ledger: {
        create: opts.entries.map((e) => ({
          points: e.points,
          type: e.type,
          reference: e.reference ?? 'seed',
          createdAt: ago(e.day ?? 0),
        })),
      },
      withdrawals: {
        create: (opts.withdrawals ?? []).map((w) => ({
          points: w.points,
          amountUsd: (w.points / 1000).toFixed(2),
          method: w.method,
          destination: w.destination,
          status: w.status,
          createdAt: ago(w.day),
        })),
      },
    },
  });

  // Spread offer completions across the 5 known offers (for the performance panel).
  const count = opts.offerActivities ?? 0;
  if (count > 0) {
    await prisma.activity.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        userId: user.id,
        kind: 'offer',
        title: OFFERS[i % OFFERS.length],
        points: 100 + ((i * 37) % 900),
        createdAt: ago(i % 7),
      })),
    });
  }
  return user;
}

async function main() {
  await prisma.user.deleteMany({
    where: { OR: [{ email: { in: [DEMO_EMAIL, ADMIN_EMAIL] } }, { email: { endsWith: '@demo.gemone.dev' } }] },
  });

  // PostbackEvent has no FK cascade from User — clear seed/test rows so re-seeding
  // is idempotent (the fixed seed-rev-* keys would otherwise collide).
  await prisma.postbackEvent.deleteMany({
    where: { transactionId: { startsWith: 'seed-rev' } },
  });

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash: await argon2.hash(ADMIN_PASSWORD),
      displayName: 'Platform Admin',
      emailVerified: true,
      isAdmin: true,
      referralCode: 'ADMIN888',
      wallet: { create: { balance: 0 } },
    },
  });

  // --- Demo user Ashley (drives the user dashboard; values match the design) ---
  const ashley = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await argon2.hash(DEMO_PASSWORD),
      displayName: 'Ashley Morgan',
      emailVerified: true,
      level: 12,
      xp: 3200,
      country: 'US',
      referralCode: 'ASHLEY24',
      wallet: { create: { balance: 12560, pending: 2300 } },
      ledger: {
        create: [
          { points: 50, type: 'BONUS', reference: 'signup', createdAt: ago(6) },
          { points: 4010, type: 'EARN', reference: 'offers', createdAt: ago(4) },
          { points: 3500, type: 'EARN', reference: 'offers', createdAt: ago(2) },
          { points: 5000, type: 'EARN', reference: 'offers', createdAt: ago(1) },
        ],
      },
    },
  });

  // Recent activity shown on Ashley's dashboard.
  await prisma.activity.createMany({
    data: [
      { userId: ashley.id, kind: 'survey', title: 'Survey Completed', points: 200, createdAt: new Date(now - 2 * 60_000) },
      { userId: ashley.id, kind: 'app_install', title: 'App Installed', points: 1000, createdAt: new Date(now - 60 * 60_000) },
      { userId: ashley.id, kind: 'offer', title: 'Offer Completed', points: 3500, createdAt: new Date(now - 3 * 60 * 60_000) },
      { userId: ashley.id, kind: 'bonus', title: 'Daily Bonus Claimed', points: 50, createdAt: new Date(now - DAY) },
    ],
  });
  // 86 more offer completions across the 5 offers → 87 total "Completed Offers".
  await prisma.activity.createMany({
    data: Array.from({ length: 86 }, (_, i) => ({
      userId: ashley.id,
      kind: 'offer',
      title: OFFERS[i % OFFERS.length],
      points: 100 + ((i * 37) % 900),
      createdAt: ago((i % 7) + (i % 3) / 3),
    })),
  });

  // --- Other users: populate admin panels (withdrawals, countries, fraud) ---
  // John & Emma were invited by Ashley → she earns 10% of their earnings.
  const john = await makeUser({
    email: 'john@demo.gemone.dev', name: 'John Smith', country: 'US', referralCode: 'JOHNROCK', referredById: ashley.id,
    entries: [{ points: 60000, type: 'EARN', day: 5 }, { points: -50000, type: 'WITHDRAWAL', reference: 'withdrawal', day: 0 }],
    withdrawals: [{ points: 50000, method: 'paypal', destination: 'john@paypal.com', status: 'PAID', day: 0 }],
    offerActivities: 40,
  });
  const emma = await makeUser({
    email: 'emma@demo.gemone.dev', name: 'Emma Johnson', country: 'IN', referralCode: 'EMMAWINS', referredById: ashley.id,
    entries: [{ points: 30000, type: 'EARN', day: 4 }, { points: -25000, type: 'WITHDRAWAL', reference: 'withdrawal', day: 0 }],
    withdrawals: [{ points: 25000, method: 'amazon', destination: 'emma@gift.com', status: 'PAID', day: 0 }],
    offerActivities: 22,
  });

  // Ashley's referral commission: 10% of John's 60k + Emma's 30k earnings = 9,000 pts.
  // Credit her ledger + activity + wallet together so the balance == Σledger invariant holds.
  const commissions = [
    { points: 6000, ref: `referral:${john.id}` },
    { points: 3000, ref: `referral:${emma.id}` },
  ];
  await prisma.ledgerEntry.createMany({
    data: commissions.map((c) => ({ userId: ashley.id, points: c.points, type: 'BONUS' as LedgerType, reference: c.ref, createdAt: ago(1) })),
  });
  await prisma.activity.createMany({
    data: commissions.map((c) => ({ userId: ashley.id, kind: 'bonus', title: 'Referral commission', points: c.points, createdAt: ago(1) })),
  });
  await prisma.wallet.update({
    where: { userId: ashley.id },
    data: { balance: { increment: commissions.reduce((s, c) => s + c.points, 0) } },
  });
  const michael = await makeUser({
    email: 'michael@demo.gemone.dev', name: 'Michael Brown', country: 'BR', status: 'FLAGGED', referralCode: 'MIKE7788',
    entries: [{ points: 120000, type: 'EARN', day: 6 }, { points: -100000, type: 'WITHDRAWAL', reference: 'withdrawal', day: 0 }],
    withdrawals: [{ points: 100000, method: 'visa', destination: 'michael@paypal.com', status: 'PENDING', day: 0 }],
    offerActivities: 30,
  });
  const sophia = await makeUser({
    email: 'sophia@demo.gemone.dev', name: 'Sophia Davis', country: 'PH', referralCode: 'SOPHIA99',
    entries: [{ points: 80000, type: 'EARN', day: 3 }, { points: -75000, type: 'WITHDRAWAL', reference: 'withdrawal', day: 1 }],
    withdrawals: [{ points: 75000, method: 'paypal', destination: 'sophia@paypal.com', status: 'PAID', day: 1 }],
    offerActivities: 18,
  });
  const william = await makeUser({
    email: 'william@demo.gemone.dev', name: 'William Wilson', country: 'DE', status: 'SUSPENDED', referralCode: 'WILL5566',
    entries: [{ points: 20000, type: 'EARN', day: 2 }, { points: -15000, type: 'WITHDRAWAL', reference: 'withdrawal', day: 1 }],
    withdrawals: [{ points: 15000, method: 'googleplay', destination: 'william@play.com', status: 'PROCESSING', day: 1 }],
    offerActivities: 12,
  });

  // Fraud logs for the flagged/suspended accounts (Fraud & Risk panel).
  await prisma.fraudLog.createMany({
    data: [
      { userId: michael.id, type: 'vpn', severity: 'high', detail: 'VPN/proxy IP (score 90)', createdAt: ago(2) },
      { userId: michael.id, type: 'velocity', severity: 'high', detail: '120,000 pts in 10m', createdAt: ago(1) },
      { userId: william.id, type: 'duplicate_ip', severity: 'medium', detail: '3 accounts share IP', createdAt: ago(3) },
      { userId: william.id, type: 'reversal_abuse', severity: 'high', detail: '4 reversals in 24h', createdAt: ago(0) },
    ],
  });

  // A few chargebacks/reversals for the metric + KPI.
  await prisma.postbackEvent.createMany({
    data: [0, 1, 2].map((i) => ({
      provider: 'adgem', transactionId: `seed-rev-${i}`, type: 'reversal',
      userId: [john.id, michael.id, william.id][i], points: 1000, createdAt: ago(i),
    })),
  });

  console.log(`Seeded: admin ${ADMIN_EMAIL}/${ADMIN_PASSWORD}, demo ${DEMO_EMAIL}/${DEMO_PASSWORD}, +5 demo users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
