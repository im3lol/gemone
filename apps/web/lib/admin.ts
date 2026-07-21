import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type AdminStats = {
  totals: {
    users: number;
    new7d: number;
    active: number;
    flagged: number;
    suspended: number;
    earningsUsd: string;
    paidUsd: string;
    offersCompleted: number;
    fraudBlocked: number;
  };
  series: {
    days: string[];
    earningsUsd: number[];
    payoutsUsd: number[];
    fraud: number[];
    users: number[];
    offers: number[];
  };
  recentWithdrawals: { name: string; method: string; amountUsd: string; status: string; date: string }[];
  offerPerformance: { title: string; completions: number; earningsUsd: string }[];
  topCountries: { code: string; users: number }[];
  fraud: { suspiciousSignups: number; blockedIps: number; chargebacks: number };
  kpis: { trustScore: number; chargebackRate: number; payoutSuccessRate: number };
};

/** Admin-only fetch. Non-admins are bounced to their dashboard. */
export async function getAdminStats(): Promise<AdminStats> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/admin/stats", { token });
  if (res.status === 401) redirect("/login");
  if (res.status === 403) redirect("/dashboard");
  if (!res.ok) throw new Error(`Admin stats failed: ${res.status}`);
  return res.json();
}

async function adminGet(path: string) {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api(path, { token });
  if (res.status === 401) redirect("/login");
  if (res.status === 403) redirect("/dashboard");
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export type AdminWithdrawal = {
  id: string;
  points: number;
  amountUsd: string;
  method: string;
  destination: string;
  status: string;
  createdAt: string;
};
export type FraudLogRow = { id: string; userId: string; type: string; severity: string; detail: string; createdAt: string };
export type FlaggedUser = { id: string; email: string; status: string; signupIp: string | null; createdAt: string };
export type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  country: string | null;
  createdAt: string;
  wallet: { balance: number } | null;
};

export const getPendingWithdrawals = (): Promise<AdminWithdrawal[]> => adminGet("/admin/withdrawals");
export const getFraudLogs = (): Promise<FraudLogRow[]> => adminGet("/admin/fraud/logs");
export const getFlaggedUsers = (): Promise<FlaggedUser[]> => adminGet("/admin/fraud/flagged");
export const getAdminUsers = (q?: string): Promise<AdminUser[]> =>
  adminGet(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);

const COUNTRIES: Record<string, { flag: string; name: string }> = {
  US: { flag: "🇺🇸", name: "United States" },
  IN: { flag: "🇮🇳", name: "India" },
  BR: { flag: "🇧🇷", name: "Brazil" },
  PH: { flag: "🇵🇭", name: "Philippines" },
  DE: { flag: "🇩🇪", name: "Germany" },
  GB: { flag: "🇬🇧", name: "United Kingdom" },
};
const METHOD_COLOR: Record<string, string> = {
  paypal: "#003087",
  amazon: "#ff9900",
  visa: "#1a1f71",
  googleplay: "#00a672",
};
const METHOD_LABEL: Record<string, string> = {
  paypal: "PayPal",
  amazon: "Amazon Gift Card",
  visa: "Visa Gift Card",
  googleplay: "Google Play",
};

const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : "0.0") + "%";
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

/** Map raw stats into the presentation shapes the admin components render. */
export function buildAdminView(s: AdminStats) {
  const t = s.totals;
  const total = t.users || 1;

  const metrics = [
    { label: "Total Users", value: t.users.toLocaleString(), delta: pct(t.new7d, total), icon: "users", color: "#12b76a", tint: "bg-brand-50", spark: s.series.users },
    { label: "Total Earnings", value: `$${t.earningsUsd}`, delta: pct(sum(s.series.earningsUsd), Number(t.earningsUsd) || 1), icon: "wallet", color: "#3b82f6", tint: "bg-blue-50", spark: s.series.earningsUsd },
    { label: "Total Paid", value: `$${t.paidUsd}`, delta: pct(sum(s.series.payoutsUsd), Number(t.paidUsd) || 1), icon: "send", color: "#8b5cf6", tint: "bg-purple-50", spark: s.series.payoutsUsd },
    { label: "Offers Completed", value: t.offersCompleted.toLocaleString(), delta: pct(sum(s.series.offers), t.offersCompleted || 1), icon: "target", color: "#f59e0b", tint: "bg-amber-50", spark: s.series.offers },
    { label: "Fraud Blocked", value: t.fraudBlocked.toLocaleString(), delta: pct(sum(s.series.fraud), t.fraudBlocked || 1), icon: "flag", color: "#f43f5e", tint: "bg-red-50", spark: s.series.fraud },
  ];

  const platformSeries = s.series.days.map((label, i) => ({
    label,
    earnings: s.series.earningsUsd[i],
    payouts: s.series.payoutsUsd[i],
  }));

  const usersBreakdown = [
    { name: "Active Users", value: t.active, pct: pct(t.active, total), color: "#12b76a" },
    { name: "New Users", value: t.new7d, pct: pct(t.new7d, total), color: "#3b82f6" },
    { name: "Flagged", value: t.flagged, pct: pct(t.flagged, total), color: "#f59e0b" },
    { name: "Suspended", value: t.suspended, pct: pct(t.suspended, total), color: "#f43f5e" },
  ];

  const topCountries = s.topCountries.map((c) => ({
    flag: COUNTRIES[c.code]?.flag ?? "🏳️",
    name: COUNTRIES[c.code]?.name ?? c.code,
    users: c.users.toLocaleString(),
    pct: pct(c.users, total),
  }));

  const withdrawals = s.recentWithdrawals.map((w) => ({
    name: w.name,
    method: METHOD_LABEL[w.method] ?? w.method,
    methodColor: METHOD_COLOR[w.method] ?? "#64748b",
    amount: `$${w.amountUsd}`,
    status: w.status.charAt(0) + w.status.slice(1).toLowerCase(),
    date: new Date(w.date).toLocaleString(),
  }));

  const palette = ["#b91c1c", "#dc2626", "#f59e0b", "#111827", "#00d54b"];
  const offerPerformance = s.offerPerformance.map((o, i) => ({
    name: o.title,
    completions: o.completions.toLocaleString(),
    earnings: `$${o.earningsUsd}`,
    color: palette[i % palette.length],
    letter: o.title.charAt(0),
  }));

  const fraudSeries = s.series.days.map((label, i) => ({ label, v: s.series.fraud[i] }));
  const fraudCounters = [
    { icon: "alert", title: "Suspicious Signups", value: s.fraud.suspiciousSignups.toLocaleString(), color: "text-red-500", tint: "bg-red-50" },
    { icon: "ban", title: "Blocked IPs", value: s.fraud.blockedIps.toLocaleString(), color: "text-blue-500", tint: "bg-blue-50" },
    { icon: "card", title: "Chargebacks", value: s.fraud.chargebacks.toLocaleString(), color: "text-emerald-500", tint: "bg-emerald-50" },
  ];

  const kpis = [
    { icon: "shield", title: "Trust Score", value: `${s.kpis.trustScore}%`, tag: s.kpis.trustScore >= 80 ? "Good" : "Watch", tagTone: "green", progress: s.kpis.trustScore, tint: "bg-emerald-50", bar: "bg-brand-500" },
    { icon: "chargeback", title: "Chargeback Rate", value: `${s.kpis.chargebackRate}%`, tag: s.kpis.chargebackRate < 1 ? "Low" : "High", tagTone: "blue", progress: Math.min(s.kpis.chargebackRate * 10, 100), tint: "bg-blue-50", bar: "bg-blue-500" },
    { icon: "payout", title: "Payout Success Rate", value: `${s.kpis.payoutSuccessRate}%`, tag: s.kpis.payoutSuccessRate >= 95 ? "Excellent" : "Fair", tagTone: "purple", progress: s.kpis.payoutSuccessRate, tint: "bg-purple-50", bar: "bg-purple-500" },
    { icon: "status", title: "System Status", value: "All Systems Operational", tag: "100% Uptime", tagTone: "amber", progress: 100, tint: "bg-amber-50", bar: "bg-amber-500" },
  ];

  return { metrics, platformSeries, usersBreakdown, total: t.users, topCountries, withdrawals, offerPerformance, fraudSeries, fraudCounters, kpis };
}

export type AdminView = ReturnType<typeof buildAdminView>;
