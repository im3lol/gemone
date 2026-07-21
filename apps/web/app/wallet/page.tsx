import Link from "next/link";
import { PageShell } from "@/components/dashboard/PageShell";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getDashboard } from "@/lib/dashboard";
import { getTransactions, type LedgerEntry } from "@/lib/transactions";

export const metadata = { title: "Wallet — GemOne" };

const TYPE_TONE: Record<LedgerEntry["type"], BadgeTone> = {
  BONUS: "purple",
  EARN: "green",
  WITHDRAWAL: "blue",
  REVERSAL: "red",
  ADJUSTMENT: "slate",
};

const usd = (points: number) => (points / 1000).toFixed(2);

export default async function WalletPage() {
  const [data, entries] = await Promise.all([getDashboard(), getTransactions()]);

  const earned = entries.filter((e) => e.points > 0).reduce((s, e) => s + e.points, 0);
  const withdrawn = entries
    .filter((e) => e.type === "WITHDRAWAL")
    .reduce((s, e) => s + Math.abs(e.points), 0);

  const cards = [
    { label: "Available", value: data.stats.balance, sub: `≈ $${data.stats.balanceUsd}`, tint: "bg-brand-50", accent: "text-brand-600" },
    { label: "Pending", value: data.stats.pending, sub: `≈ $${data.stats.pendingUsd}`, tint: "bg-amber-50", accent: "text-amber-600" },
    { label: "Total earned", value: earned, sub: `≈ $${usd(earned)}`, tint: "bg-blue-50", accent: "text-blue-600" },
    { label: "Total withdrawn", value: withdrawn, sub: `≈ $${usd(withdrawn)}`, tint: "bg-purple-50", accent: "text-purple-600" },
  ];

  return (
    <PageShell current="Wallet" title="Wallet" subtitle="Your balance and where every point came from.">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl border border-slate-100 p-5 shadow-sm ${c.tint}`}>
            <p className="text-sm font-medium text-slate-500">{c.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{c.value.toLocaleString()}</p>
            <p className={`mt-1 text-xs font-medium ${c.accent}`}>{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-3">
        <Link href="/withdraw" className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
          Withdraw
        </Link>
        <Link href="/earn" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Earn more
        </Link>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Recent activity</h2>
          <Link href="/transactions" className="text-sm font-semibold text-brand-600">
            View all →
          </Link>
        </div>
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No transactions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-400">
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Reference</th>
                  <th className="pb-3 text-right font-medium">Points</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {entries.slice(0, 10).map((e) => (
                  <tr key={e.id}>
                    <td className="py-3">
                      <Badge tone={TYPE_TONE[e.type]}>{e.type}</Badge>
                    </td>
                    <td className="py-3 text-slate-500">{e.reference ?? "—"}</td>
                    <td className={`py-3 text-right font-semibold ${e.points >= 0 ? "text-brand-600" : "text-red-500"}`}>
                      {e.points >= 0 ? "+" : ""}
                      {e.points.toLocaleString()}
                    </td>
                    <td className="py-3 whitespace-nowrap text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
