import { PageShell } from "@/components/dashboard/PageShell";
import { getDashboard } from "@/lib/dashboard";
import { getReferral } from "@/lib/referrals";
import { getTransactions } from "@/lib/transactions";

export const metadata = { title: "Achievements — GemOne" };

type Badge = { emoji: string; title: string; text: string; unlocked: boolean };

export default async function AchievementsPage() {
  const [data, entries, referral] = await Promise.all([getDashboard(), getTransactions(), getReferral()]);

  const earned = entries.filter((e) => e.points > 0).reduce((s, e) => s + e.points, 0);
  const hasWithdrawal = entries.some((e) => e.type === "WITHDRAWAL");
  const offers = data.stats.completedOffers;

  // Every badge is decided by real account data — no mock unlocks.
  const badges: Badge[] = [
    { emoji: "👣", title: "First Steps", text: "Complete your first offer", unlocked: offers >= 1 },
    { emoji: "🔥", title: "On a Roll", text: "Complete 10 offers", unlocked: offers >= 10 },
    { emoji: "🏆", title: "Offer Master", text: "Complete 100 offers", unlocked: offers >= 100 },
    { emoji: "💰", title: "Big Earner", text: "Earn 10,000 points", unlocked: earned >= 10_000 },
    { emoji: "💎", title: "Amethyst", text: "Reach level 10", unlocked: data.user.level >= 10 },
    { emoji: "🏦", title: "Cashed Out", text: "Make your first withdrawal", unlocked: hasWithdrawal },
    { emoji: "🤝", title: "Recruiter", text: "Invite your first friend", unlocked: referral.invited >= 1 },
    { emoji: "👑", title: "High Roller", text: "Hold 50,000 points", unlocked: data.stats.balance >= 50_000 },
  ];

  const unlocked = badges.filter((b) => b.unlocked).length;

  return (
    <PageShell
      current="Achievements"
      title="Achievements"
      subtitle={
        <>
          You&apos;ve unlocked <span className="font-semibold text-brand-600">{unlocked} of {badges.length}</span> badges.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {badges.map((b) => (
          <div
            key={b.title}
            className={`rounded-2xl border p-5 text-center shadow-sm transition ${
              b.unlocked ? "border-brand-100 bg-white" : "border-slate-100 bg-slate-50"
            }`}
          >
            <div
              className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl text-3xl ${
                b.unlocked ? "bg-brand-50" : "bg-slate-100 grayscale"
              }`}
            >
              {b.unlocked ? b.emoji : "🔒"}
            </div>
            <p className={`mt-3 font-bold ${b.unlocked ? "text-slate-900" : "text-slate-400"}`}>{b.title}</p>
            <p className="mt-1 text-xs text-slate-400">{b.text}</p>
            {b.unlocked && (
              <span className="mt-2 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                Unlocked
              </span>
            )}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
