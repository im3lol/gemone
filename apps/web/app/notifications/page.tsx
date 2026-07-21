import { PageShell } from "@/components/dashboard/PageShell";
import { getDashboard } from "@/lib/dashboard";
import { getWithdrawals } from "@/lib/withdrawals";

export const metadata = { title: "Notifications — GemOne" };

type Note = { id: string; icon: string; tint: string; title: string; detail: string; at: number };

function relativeTime(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

const WITHDRAWAL_NOTE: Record<string, { icon: string; tint: string; verb: string }> = {
  PENDING: { icon: "⏳", tint: "bg-amber-50", verb: "is under review" },
  APPROVED: { icon: "✅", tint: "bg-blue-50", verb: "was approved" },
  PROCESSING: { icon: "🔄", tint: "bg-blue-50", verb: "is processing" },
  PAID: { icon: "💸", tint: "bg-brand-50", verb: "was paid" },
  REJECTED: { icon: "❌", tint: "bg-red-50", verb: "was rejected (points refunded)" },
  FAILED: { icon: "⚠️", tint: "bg-red-50", verb: "failed (points refunded)" },
};

export default async function NotificationsPage() {
  const [data, withdrawals] = await Promise.all([getDashboard(), getWithdrawals()]);

  // Real feed derived from the user's own activity + payouts — newest first.
  const notes: Note[] = [
    ...data.recentActivity.map((a) => ({
      id: `act-${a.id}`,
      icon: a.points >= 0 ? "🎯" : "↩️",
      tint: a.points >= 0 ? "bg-brand-50" : "bg-red-50",
      title: a.title,
      detail: `${a.points >= 0 ? "+" : ""}${a.points.toLocaleString()} points`,
      at: new Date(a.createdAt).getTime(),
    })),
    ...withdrawals.map((w) => {
      const n = WITHDRAWAL_NOTE[w.status] ?? { icon: "💸", tint: "bg-slate-50", verb: `is ${w.status}` };
      return {
        id: `wd-${w.id}`,
        icon: n.icon,
        tint: n.tint,
        title: `Withdrawal ${n.verb}`,
        detail: `$${w.amountUsd} via ${w.method}`,
        at: new Date(w.createdAt).getTime(),
      };
    }),
  ].sort((a, b) => b.at - a.at);

  return (
    <PageShell current="Notifications" title="Notifications" subtitle="Everything that's happened on your account.">
      <div className="rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
        {notes.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${n.tint} text-lg`}>{n.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  <p className="text-xs text-slate-400">{n.detail}</p>
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">{relativeTime(new Date(n.at).toISOString())}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
