import { CheckCircle2, ChevronRight, Clock, DollarSign, TrendingUp } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { continueEarning } from "@/lib/data";
import type { Offer } from "@/lib/offers";

const CAT_LABEL: Record<Offer["category"], string> = {
  game: "Game",
  survey: "Survey",
  app: "App",
  signup: "Sign Up",
  shopping: "Shopping",
  video: "Video",
};
const CAT_TONE: Record<Offer["category"], BadgeTone> = {
  game: "purple",
  survey: "amber",
  app: "slate",
  signup: "blue",
  shopping: "pink",
  video: "indigo",
};
const DIFF_TONE: Record<Offer["difficulty"], BadgeTone> = {
  Easy: "green",
  Medium: "amber",
  Hard: "red",
};
import type { DashboardData } from "@/lib/dashboard";

const fmt = (n: number) => n.toLocaleString("en-US");

export function Welcome({ name }: { name: string | null }) {
  const first = (name ?? "there").split(" ")[0];
  return (
    <div className="py-4">
      <p className="text-sm text-slate-400">Welcome back,</p>
      <h1 className="font-display text-3xl font-extrabold text-slate-900">
        {first}! <span>👋</span>
      </h1>
      <p className="mt-1 text-slate-500">Let&apos;s continue your earning journey today.</p>
    </div>
  );
}

export function StatCards({ data }: { data: DashboardData }) {
  const { stats, user } = data;
  const cards = [
    { label: "Current Balance", value: fmt(stats.balance), unit: "Points", sub: `≈ $${stats.balanceUsd} USD`, Icon: DollarSign, accent: "text-brand-600", tint: "bg-brand-50" },
    { label: "Today's Earnings", value: fmt(stats.todaysEarnings), unit: "Points", sub: `≈ $${stats.todaysEarningsUsd} USD`, Icon: TrendingUp, accent: "text-blue-600", tint: "bg-blue-50" },
    { label: "Pending Rewards", value: fmt(stats.pending), unit: "Points", sub: `≈ $${stats.pendingUsd} USD`, Icon: Clock, accent: "text-amber-600", tint: "bg-amber-50" },
    { label: "Completed Offers", value: fmt(stats.completedOffers), unit: "Offers", sub: "View all →", Icon: CheckCircle2, accent: "text-purple-600", tint: "bg-purple-50" },
  ];
  const xpPct = Math.min(100, Math.round((user.xp / user.xpNext) * 100));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-sm font-medium text-slate-500">{c.label}</p>
            <span className={`grid h-9 w-9 place-items-center rounded-full ${c.tint} ${c.accent}`}>
              <c.Icon className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">{c.value}</p>
          <p className="text-xs text-slate-400">{c.unit}</p>
          <p className={`mt-2 text-xs font-medium ${c.accent}`}>{c.sub}</p>
        </div>
      ))}
      {/* Level card */}
      <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold text-slate-900">Level {user.level}</p>
            <p className="text-sm font-semibold text-purple-600">{user.rank}</p>
          </div>
          <span className="text-3xl">💎</span>
        </div>
        <div className="mt-4">
          <div className="h-2 rounded-full bg-purple-100">
            <div className="h-2 rounded-full bg-purple-500" style={{ width: `${xpPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{fmt(user.xp)} / {fmt(user.xpNext)} XP</p>
          <p className="text-xs font-medium text-purple-600">You&apos;re on fire! 🔥</p>
        </div>
      </div>
    </div>
  );
}

export function RecommendedOffers({ offers }: { offers: Offer[] }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Recommended for you</h2>
          <p className="text-sm text-slate-500">Handpicked offers that pay well and match your interests.</p>
        </div>
        <a href="/offerwalls" className="text-sm font-semibold text-brand-600">
          View all offers
        </a>
      </div>
      <div className="mt-4 flex gap-4 overflow-x-auto no-scrollbar">
        {offers.length === 0 && (
          <p className="py-8 text-sm text-slate-400">No offers available right now — check back soon.</p>
        )}
        {offers.slice(0, 8).map((o) => (
          <a
            key={o.id}
            href={o.clickUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-[180px] shrink-0 rounded-2xl border border-slate-100 p-3 transition hover:border-brand-200 hover:shadow-sm"
          >
            <div
              className="grid h-24 w-full place-items-center rounded-xl text-2xl font-bold text-white"
              style={{ background: o.color }}
            >
              {o.icon}
            </div>
            <p className="mt-3 truncate text-sm font-bold text-slate-900">{o.title}</p>
            <div className="mt-1 flex gap-1">
              <Badge tone={DIFF_TONE[o.difficulty]}>{o.difficulty}</Badge>
              <Badge tone={CAT_TONE[o.category]}>{CAT_LABEL[o.category]}</Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-lg font-bold text-slate-900">{o.points.toLocaleString()}</span>
              <span className="text-xs text-brand-600">≈ ${o.payoutUsd}</span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">{o.description}</p>
          </a>
        ))}
        <button className="my-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-400">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function ContinueEarning() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Continue earning</h2>
      <p className="text-sm text-slate-500">Finish these offers to earn more rewards.</p>
      <div className="mt-4 space-y-4">
        {continueEarning.map((o) => (
          <div key={o.name} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold text-white"
              style={{ background: o.color }}
            >
              {o.letter}
            </div>
            <div className="min-w-[180px]">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                {o.name}
                {o.badges.map(([t, tone]) => (
                  <Badge key={t} tone={tone as BadgeTone}>
                    {t}
                  </Badge>
                ))}
              </p>
              <p className="text-xs text-slate-500">{o.desc}</p>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Progress</span>
                <span>{o.progress}%</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-brand-500" style={{ width: `${o.progress}%` }} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">{o.points}</p>
              <p className="text-xs text-slate-400">Points</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
