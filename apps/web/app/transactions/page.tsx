import { DashboardSidebar } from "@/components/dashboard/Sidebar";
import { DashboardTopbar } from "@/components/dashboard/Topbar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getDashboard } from "@/lib/dashboard";
import { getTransactions, type LedgerEntry } from "@/lib/transactions";

const TYPE_TONE: Record<LedgerEntry["type"], BadgeTone> = {
  BONUS: "purple",
  EARN: "green",
  WITHDRAWAL: "blue",
  REVERSAL: "red",
  ADJUSTMENT: "slate",
};

export default async function TransactionsPage() {
  const [data, entries] = await Promise.all([getDashboard(), getTransactions()]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardSidebar current="Transactions" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8">
        <DashboardTopbar name={data.user.displayName} balance={data.stats.balance} />

        <div className="py-4">
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Transactions</h1>
          <p className="mt-1 text-slate-500">Every point in and out of your wallet.</p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
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
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="py-3">
                        <Badge tone={TYPE_TONE[e.type]}>{e.type}</Badge>
                      </td>
                      <td className="py-3 text-slate-500">{e.reference ?? "—"}</td>
                      <td className={`py-3 text-right font-semibold ${e.points >= 0 ? "text-brand-600" : "text-red-500"}`}>
                        {e.points >= 0 ? "+" : ""}
                        {e.points.toLocaleString()}
                      </td>
                      <td className="py-3 whitespace-nowrap text-slate-400">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
