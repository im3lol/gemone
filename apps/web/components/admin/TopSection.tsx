import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  Flag,
  type LucideIcon,
  Send,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { AreaTrend, Donut, Sparkline } from "@/components/ui/charts";
import type { AdminView } from "@/lib/admin";

const metricIcons: Record<string, LucideIcon> = {
  users: Users,
  wallet: Wallet,
  send: Send,
  target: Target,
  flag: Flag,
};

export function PageHeader() {
  return (
    <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Overview of platform performance and key metrics</p>
      </div>
      <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600">
        <Calendar className="h-4 w-4 text-slate-400" />
        Last 7 days
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
    </div>
  );
}

export function MetricCards({ metrics }: { metrics: AdminView["metrics"] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((m) => {
        const Icon = metricIcons[m.icon];
        return (
          <div key={m.label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-full ${m.tint}`} style={{ color: m.color }}>
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-slate-500">{m.label}</p>
                <p className="text-xl font-bold text-slate-900">{m.value}</p>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600">
              <ArrowUpRight className="h-3.5 w-3.5" />
              {m.delta} <span className="text-slate-400">this week</span>
            </p>
            <div className="mt-1 -mb-1">
              <Sparkline data={m.spark} color={m.color} height={40} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlatformOverview({ data }: { data: AdminView["platformSeries"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900">Platform Overview</h2>
          <div className="mt-2 flex gap-4 text-xs font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Earnings
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Payouts
            </span>
          </div>
        </div>
        <button className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
          Daily <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-4">
        <AreaTrend data={data} />
      </div>
    </div>
  );
}

export function UsersOverview({ data, total }: { data: AdminView["usersBreakdown"]; total: number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Users Overview</h2>
      <div className="mt-3 flex flex-col items-center gap-4">
        <Donut
          data={data.map((u) => ({ name: u.name, value: u.value, color: u.color }))}
          centerTop={total.toLocaleString()}
          centerBottom="Total Users"
        />
        <div className="w-full space-y-2">
          {data.map((u) => (
            <div key={u.name} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color }} />
              <span className="flex-1 text-slate-500">{u.name}</span>
              <span className="font-semibold text-slate-900">{u.value.toLocaleString()}</span>
              <span className="text-xs text-slate-400">({u.pct})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TopCountries({ countries }: { countries: AdminView["topCountries"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Top Countries</h2>
      <div className="mt-4 space-y-4">
        {countries.length === 0 && <p className="text-sm text-slate-400">No country data yet.</p>}
        {countries.map((c) => (
          <div key={c.name} className="flex items-center gap-3">
            <span className="text-xl">{c.flag}</span>
            <span className="flex-1 text-sm font-medium text-slate-700">{c.name}</span>
            <span className="text-sm font-semibold text-slate-900">{c.users}</span>
            <span className="text-xs text-slate-400">({c.pct})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
