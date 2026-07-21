import { AdminSidebar } from "@/components/admin/Sidebar";
import { AdminTopbar } from "@/components/admin/Topbar";
import {
  MetricCards,
  PageHeader,
  PlatformOverview,
  TopCountries,
  UsersOverview,
} from "@/components/admin/TopSection";
import {
  BottomStats,
  FraudRisk,
  OfferPerformance,
  RecentWithdrawals,
} from "@/components/admin/BottomSection";
import { buildAdminView, getAdminStats } from "@/lib/admin";

export default async function AdminPage() {
  const stats = await getAdminStats();
  const v = buildAdminView(stats);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar current="Dashboard" />
      <div className="flex-1">
        <AdminTopbar />
        <div className="space-y-5 px-6 pb-10">
          <PageHeader />
          <MetricCards metrics={v.metrics} />

          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <PlatformOverview data={v.platformSeries} />
            </div>
            <div className="lg:col-span-4">
              <UsersOverview data={v.usersBreakdown} total={v.total} />
            </div>
            <div className="lg:col-span-3">
              <TopCountries countries={v.topCountries} />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <RecentWithdrawals rows={v.withdrawals} />
            </div>
            <div className="lg:col-span-4">
              <OfferPerformance rows={v.offerPerformance} />
            </div>
            <div className="lg:col-span-3">
              <FraudRisk series={v.fraudSeries} counters={v.fraudCounters} />
            </div>
          </div>

          <BottomStats kpis={v.kpis} />
        </div>
      </div>
    </div>
  );
}
