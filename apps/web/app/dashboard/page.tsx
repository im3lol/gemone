import { DashboardSidebar } from "@/components/dashboard/Sidebar";
import { DashboardTopbar } from "@/components/dashboard/Topbar";
import { RecommendedOffers, StatCards, Welcome } from "@/components/dashboard/Main";
import { DailyBonusCard } from "@/components/dashboard/DailyBonusCard";
import { Achievements, RecentActivity, ReferralCard, type TeaserBadge } from "@/components/dashboard/RightRail";
import { getDailyBonus } from "@/lib/daily-bonus";
import { getDashboard } from "@/lib/dashboard";
import { getOffers } from "@/lib/offers";
import { getReferral } from "@/lib/referrals";

export default async function DashboardPage() {
  const [data, offers, referral, bonus] = await Promise.all([
    getDashboard(),
    getOffers(),
    getReferral(),
    getDailyBonus(),
  ]);

  // Teaser badges derived from real account data (full set lives on /achievements).
  const badges: TeaserBadge[] = [
    { emoji: "👣", title: "First Steps", unlocked: data.stats.completedOffers >= 1 },
    { emoji: "💎", title: "Amethyst", unlocked: data.user.level >= 10 },
    { emoji: "🤝", title: "Recruiter", unlocked: referral.invited >= 1 },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardSidebar />
      <div className="flex-1 px-4 sm:px-6 lg:px-8">
        <DashboardTopbar name={data.user.displayName} balance={data.stats.balance} />
        <Welcome name={data.user.displayName} />
        <StatCards data={data} />
        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <DailyBonusCard state={bonus} />
            <RecommendedOffers offers={offers} />
          </div>
          <div className="space-y-5">
            <Achievements badges={badges} />
            <ReferralCard referral={referral} />
            <RecentActivity activities={data.recentActivity} />
          </div>
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
