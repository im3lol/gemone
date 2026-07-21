import type { ReactNode } from "react";
import { getDashboard } from "@/lib/dashboard";
import { DashboardSidebar } from "./Sidebar";
import { DashboardTopbar } from "./Topbar";

/** Shared logged-in page frame: sidebar + topbar + optional page header.
 *  Fetches the dashboard once so every page shows the live name + balance. */
export async function PageShell({
  current,
  title,
  subtitle,
  children,
}: {
  current: string;
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const data = await getDashboard();
  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardSidebar current={current} />
      <div className="flex-1 px-4 sm:px-6 lg:px-8">
        <DashboardTopbar name={data.user.displayName} balance={data.stats.balance} />
        {(title || subtitle) && (
          <div className="py-4">
            {title && <h1 className="font-display text-3xl font-extrabold text-slate-900">{title}</h1>}
            {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
          </div>
        )}
        {children}
        <div className="h-8" />
      </div>
    </div>
  );
}
