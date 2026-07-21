import { Bell, Gift, LogOut } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/auth-actions";

export function DashboardTopbar({ name, balance }: { name: string | null; balance: number }) {
  return (
    <div className="flex items-center justify-end gap-4 py-2">
      <Link href="/daily-bonus" title="Daily bonus" className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
        <Gift className="h-5 w-5" />
      </Link>
      <Link href="/notifications" title="Notifications" className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
        <Bell className="h-5 w-5" />
      </Link>
      <div className="flex items-center gap-3 rounded-full border border-slate-100 py-1 pl-1 pr-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-lg">🙂</span>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-900">{name ?? "Member"}</p>
          <p className="text-xs font-medium text-brand-600">◈ {balance.toLocaleString("en-US")}</p>
        </div>
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          title="Log out"
          className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
