import { AdminSidebar } from "@/components/admin/Sidebar";
import { AdminTopbar } from "@/components/admin/Topbar";
import { UserStatusButton } from "@/components/admin/UserStatusButton";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getFlaggedUsers, getFraudLogs } from "@/lib/admin";

const STATUS_TONE: Record<string, BadgeTone> = { FLAGGED: "amber", SUSPENDED: "red", ACTIVE: "green" };
const SEV_TONE: Record<string, BadgeTone> = { high: "red", medium: "amber", low: "slate" };

export default async function AdminFraudPage() {
  const [flagged, logs] = await Promise.all([getFlaggedUsers(), getFraudLogs()]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar current="Fraud Detection" />
      <div className="flex-1">
        <AdminTopbar />
        <div className="px-6 pb-10">
          <div className="py-6">
            <h1 className="font-display text-2xl font-bold text-slate-900">Fraud & Risk</h1>
            <p className="mt-1 text-sm text-slate-500">Flagged accounts and the signals behind them.</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Flagged accounts</h2>
              {flagged.length === 0 ? (
                <p className="mt-6 text-sm text-slate-400">No flagged accounts.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {flagged.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 border-b border-slate-50 pb-3 last:border-0">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{u.email}</p>
                        <p className="text-xs text-slate-400">{u.signupIp ?? "no ip"}</p>
                      </div>
                      <Badge tone={STATUS_TONE[u.status] ?? "slate"}>{u.status}</Badge>
                      <UserStatusButton id={u.id} status={u.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Recent fraud signals</h2>
              {logs.length === 0 ? (
                <p className="mt-6 text-sm text-slate-400">No signals logged.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {logs.slice(0, 12).map((l) => (
                    <div key={l.id} className="flex items-start gap-3">
                      <Badge tone={SEV_TONE[l.severity] ?? "slate"}>{l.severity}</Badge>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{l.type}</p>
                        <p className="text-xs text-slate-500">{l.detail}</p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-slate-400">
                        {new Date(l.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
