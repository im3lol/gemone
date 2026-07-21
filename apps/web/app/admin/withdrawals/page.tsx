import { AdminSidebar } from "@/components/admin/Sidebar";
import { AdminTopbar } from "@/components/admin/Topbar";
import { WithdrawalActions } from "@/components/admin/WithdrawalActions";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getPendingWithdrawals } from "@/lib/admin";

const TONE: Record<string, BadgeTone> = {
  PENDING: "amber",
  APPROVED: "blue",
  PROCESSING: "blue",
  PAID: "green",
  REJECTED: "red",
  FAILED: "red",
};

export default async function AdminWithdrawalsPage() {
  const rows = await getPendingWithdrawals();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar current="Withdrawals" />
      <div className="flex-1">
        <AdminTopbar />
        <div className="px-6 pb-10">
          <div className="py-6">
            <h1 className="font-display text-2xl font-bold text-slate-900">Withdrawals</h1>
            <p className="mt-1 text-sm text-slate-500">Review and action pending payout requests.</p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No pending withdrawals. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-400">
                      <th className="pb-3 font-medium">Amount</th>
                      <th className="pb-3 font-medium">Method</th>
                      <th className="pb-3 font-medium">Destination</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium">Requested</th>
                      <th className="pb-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rows.map((w) => (
                      <tr key={w.id}>
                        <td className="py-3">
                          <span className="font-semibold text-slate-900">${w.amountUsd}</span>
                          <span className="ml-1 text-xs text-slate-400">{w.points.toLocaleString()} pts</span>
                        </td>
                        <td className="py-3 capitalize text-slate-600">{w.method}</td>
                        <td className="py-3 text-slate-500">{w.destination}</td>
                        <td className="py-3">
                          <Badge tone={TONE[w.status] ?? "slate"}>{w.status}</Badge>
                        </td>
                        <td className="py-3 whitespace-nowrap text-slate-400">
                          {new Date(w.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3">
                          <WithdrawalActions id={w.id} status={w.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
