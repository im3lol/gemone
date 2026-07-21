import type { DashboardData } from "@/lib/dashboard";

export type TeaserBadge = { emoji: string; title: string; unlocked: boolean };

const activityStyle: Record<string, { emoji: string; tint: string }> = {
  survey: { emoji: "📋", tint: "bg-blue-50" },
  app_install: { emoji: "📱", tint: "bg-emerald-50" },
  offer: { emoji: "🎯", tint: "bg-purple-50" },
  bonus: { emoji: "🎁", tint: "bg-amber-50" },
  video: { emoji: "▶️", tint: "bg-pink-50" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export function Achievements({ badges }: { badges: TeaserBadge[] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">Achievements</h2>
        <a href="/achievements" className="text-xs font-semibold text-brand-600">
          View all
        </a>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {badges.map((b) => (
          <div key={b.title}>
            <div
              className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl shadow-sm ${
                b.unlocked ? "bg-brand-50" : "bg-slate-100 grayscale"
              }`}
            >
              {b.unlocked ? b.emoji : "🔒"}
            </div>
            <p className={`mt-2 text-xs font-bold ${b.unlocked ? "text-slate-900" : "text-slate-400"}`}>{b.title}</p>
            <p className="text-[10px] text-slate-400">{b.unlocked ? "Unlocked" : "Locked"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ReferralCard } from "./ReferralCard";

export function RecentActivity({ activities }: { activities: DashboardData["recentActivity"] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">Recent Activity</h2>
        <a href="/notifications" className="text-xs font-semibold text-brand-600">
          View all
        </a>
      </div>
      <div className="mt-4 space-y-3">
        {activities.length === 0 && (
          <p className="text-sm text-slate-400">No activity yet — complete an offer to get started.</p>
        )}
        {activities.map((a) => {
          const s = activityStyle[a.kind] ?? { emoji: "✨", tint: "bg-slate-50" };
          return (
            <div key={a.id} className="flex items-center gap-3">
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${s.tint} text-base`}>{s.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-400">{relativeTime(a.createdAt)}</p>
              </div>
              <span className="text-sm font-bold text-brand-600">
                {a.points >= 0 ? "+" : ""}
                {a.points.toLocaleString("en-US")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
