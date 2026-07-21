import {
  Activity,
  AlertCircle,
  Ban,
  CircleDollarSign,
  CreditCard,
  type LucideIcon,
  ShieldCheck,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { LineTrend } from "@/components/ui/charts";
import type { AdminView } from "@/lib/admin";

const statusTone: Record<string, BadgeTone> = {
  Paid: "green",
  Completed: "green",
  Approved: "blue",
  Pending: "amber",
  Processing: "blue",
  Rejected: "red",
  Failed: "red",
};

export function RecentWithdrawals({ rows }: { rows: AdminView["withdrawals"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">Recent Withdrawals</h2>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-slate-400">
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium">Method</th>
              <th className="pb-3 font-medium">Amount</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((w) => (
              <tr key={w.name + w.date}>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs">🙂</span>
                    <span className="font-medium text-slate-800">{w.name}</span>
                  </div>
                </td>
                <td className="py-3">
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: w.methodColor }} />
                    {w.method}
                  </span>
                </td>
                <td className="py-3 font-semibold text-slate-900">{w.amount}</td>
                <td className="py-3">
                  <Badge tone={statusTone[w.status] ?? "slate"}>{w.status}</Badge>
                </td>
                <td className="py-3 whitespace-nowrap text-slate-400">{w.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a href="#" className="mt-3 inline-block text-sm font-semibold text-brand-600">
        View all withdrawals →
      </a>
    </div>
  );
}

export function OfferPerformance({ rows }: { rows: AdminView["offerPerformance"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Offer Performance</h2>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-slate-400">
            <th className="pb-3 font-medium">Offer</th>
            <th className="pb-3 text-right font-medium">Completions</th>
            <th className="pb-3 text-right font-medium">Earnings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((o) => (
            <tr key={o.name}>
              <td className="py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white"
                    style={{ background: o.color }}
                  >
                    {o.letter}
                  </span>
                  <span className="font-medium text-slate-800">{o.name}</span>
                </div>
              </td>
              <td className="py-3 text-right text-slate-600">{o.completions}</td>
              <td className="py-3 text-right font-semibold text-slate-900">{o.earnings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a href="#" className="mt-3 inline-block text-sm font-semibold text-brand-600">
        View all offers →
      </a>
    </div>
  );
}

const counterIcons: Record<string, LucideIcon> = {
  alert: AlertCircle,
  ban: Ban,
  card: CreditCard,
};

export function FraudRisk({ series, counters }: { series: AdminView["fraudSeries"]; counters: AdminView["fraudCounters"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Fraud & Risk Overview</h2>
      <div className="mt-3">
        <LineTrend data={series} />
      </div>
      <div className="mt-4 space-y-3">
        {counters.map((c) => {
          const Icon = counterIcons[c.icon];
          return (
            <div key={c.title} className="flex items-center gap-3">
              <span className={`grid h-8 w-8 place-items-center rounded-lg ${c.tint} ${c.color}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm text-slate-600">{c.title}</span>
              <span className="text-sm font-bold text-slate-900">{c.value}</span>
            </div>
          );
        })}
      </div>
      <a href="#" className="mt-4 inline-block text-sm font-semibold text-brand-600">
        View fraud dashboard →
      </a>
    </div>
  );
}

const kpiIcons: Record<string, LucideIcon> = {
  shield: ShieldCheck,
  chargeback: CreditCard,
  payout: CircleDollarSign,
  status: Activity,
};

export function BottomStats({ kpis }: { kpis: AdminView["kpis"] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => {
        const Icon = kpiIcons[k.icon];
        return (
          <div key={k.title} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${k.tint} text-slate-700`}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-500">{k.title}</p>
                  <Badge tone={k.tagTone as BadgeTone}>{k.tag}</Badge>
                </div>
                <p className="mt-1 text-xl font-bold text-slate-900">{k.value}</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-100">
              <div className={`h-1.5 rounded-full ${k.bar}`} style={{ width: `${k.progress}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
