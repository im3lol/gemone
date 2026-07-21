import { DashboardSidebar } from "@/components/dashboard/Sidebar";
import { DashboardTopbar } from "@/components/dashboard/Topbar";
import { WithdrawForm } from "@/components/dashboard/WithdrawForm";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getDashboard } from "@/lib/dashboard";
import { getWithdrawals, type WithdrawalStatus } from "@/lib/withdrawals";

const STATUS_TONE: Record<WithdrawalStatus, BadgeTone> = {
  PAID: "green",
  PENDING: "amber",
  APPROVED: "blue",
  PROCESSING: "blue",
  REJECTED: "red",
  FAILED: "red",
};

export default async function WithdrawPage() {
  const [data, withdrawals] = await Promise.all([getDashboard(), getWithdrawals()]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardSidebar current="Withdraw" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8">
        <DashboardTopbar name={data.user.displayName} balance={data.stats.balance} />

        <div className="py-4">
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Withdraw</h1>
          <p className="mt-1 text-slate-500">
            Cash out your points — you have{" "}
            <span className="font-semibold text-brand-600">{data.stats.balance.toLocaleString()} points</span>{" "}
            (≈ ${data.stats.balanceUsd}).
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <WithdrawForm balance={data.stats.balance} />

          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Withdrawal history</h2>
            {withdrawals.length === 0 ? (
              <p className="mt-6 text-sm text-slate-400">No withdrawals yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-400">
                      <th className="pb-3 font-medium">Amount</th>
                      <th className="pb-3 font-medium">Method</th>
                      <th className="pb-3 font-medium">Destination</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td className="py-3">
                          <span className="font-semibold text-slate-900">${w.amountUsd}</span>
                          <span className="ml-1 text-xs text-slate-400">{w.points.toLocaleString()} pts</span>
                        </td>
                        <td className="py-3 capitalize text-slate-600">{w.method}</td>
                        <td className="py-3 text-slate-500">{w.destination}</td>
                        <td className="py-3">
                          <Badge tone={STATUS_TONE[w.status]}>{w.status}</Badge>
                        </td>
                        <td className="py-3 whitespace-nowrap text-slate-400">
                          {new Date(w.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
