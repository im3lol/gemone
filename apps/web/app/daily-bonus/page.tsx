import { DailyBonusCard } from "@/components/dashboard/DailyBonusCard";
import { PageShell } from "@/components/dashboard/PageShell";
import { getDailyBonus } from "@/lib/daily-bonus";

export const metadata = { title: "Daily Bonus — GemOne" };

export default async function DailyBonusPage() {
  const bonus = await getDailyBonus();

  return (
    <PageShell current="Daily Bonus" title="Daily Bonus" subtitle="Claim every day — the longer your streak, the bigger the reward.">
      <DailyBonusCard state={bonus} />

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="font-bold text-slate-900">7-day rewards</h2>
        <p className="text-sm text-slate-500">Miss a day and the streak resets to day 1.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {bonus.rewards.map((r, i) => {
            const day = i + 1;
            const done = bonus.canClaim ? day < bonus.weekDay : day <= bonus.weekDay;
            return (
              <div
                key={day}
                className={`rounded-xl border p-4 text-center ${
                  done ? "border-brand-100 bg-brand-50" : "border-slate-100 bg-white"
                }`}
              >
                <p className="text-xs font-medium text-slate-400">Day {day}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{r}</p>
                <p className="text-[10px] text-slate-400">points</p>
              </div>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
