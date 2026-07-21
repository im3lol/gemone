import {
  ArrowDownToLine,
  Bell,
  CheckSquare,
  ClipboardList,
  Gamepad2,
  Gift,
  Home,
  LayoutGrid,
  type LucideIcon,
  PlayCircle,
  Receipt,
  Settings,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

type Item = { icon: LucideIcon; label: string; href?: string; badge?: number };

const groupA: Item[] = [
  { icon: Home, label: "Dashboard", href: "/dashboard" },
  { icon: Gamepad2, label: "Earn", href: "/earn" },
  { icon: LayoutGrid, label: "Offerwalls", href: "/offerwalls" },
  { icon: ClipboardList, label: "Surveys", href: "/surveys" },
  { icon: PlayCircle, label: "Watch Videos", href: "/videos" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: Gift, label: "Daily Bonus", href: "/daily-bonus" },
];

const groupB: Item[] = [
  { icon: Wallet, label: "Wallet", href: "/wallet" },
  { icon: ArrowDownToLine, label: "Withdraw", href: "/withdraw" },
  { icon: Receipt, label: "Transactions", href: "/transactions" },
  { icon: Users, label: "Referrals", href: "/referrals" },
  { icon: Trophy, label: "Achievements", href: "/achievements" },
];

const groupC: Item[] = [
  { icon: Bell, label: "Notifications", href: "/notifications" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

function NavItem({ icon: Icon, label, href, badge, active }: Item & { active: boolean }) {
  const cls = `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
    active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
  }`;
  const inner = (
    <>
      <Icon className="h-5 w-5" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white">
          {badge}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <a href="#" className={cls}>
      {inner}
    </a>
  );
}

export function DashboardSidebar({ current = "Dashboard" }: { current?: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-100 bg-white p-4 lg:flex">
      <div className="flex items-center justify-between px-2 py-2">
        <Logo />
      </div>
      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto no-scrollbar">
        {groupA.map((i) => (
          <NavItem key={i.label} {...i} active={i.label === current} />
        ))}
        <hr className="my-3 border-slate-100" />
        {groupB.map((i) => (
          <NavItem key={i.label} {...i} active={i.label === current} />
        ))}
        <hr className="my-3 border-slate-100" />
        {groupC.map((i) => (
          <NavItem key={i.label} {...i} active={i.label === current} />
        ))}
      </nav>
      <div className="mt-4 rounded-2xl bg-slate-50 p-4">
        <p className="text-sm font-bold text-slate-900">Get the app</p>
        <p className="mt-1 text-xs text-slate-500">Earn on the go. Anytime, anywhere.</p>
        <div className="mt-3 flex gap-2">
          <span className="grid flex-1 place-items-center rounded-lg bg-slate-900 py-1.5 text-[10px] font-semibold text-white">
            ▶ Play
          </span>
          <span className="grid flex-1 place-items-center rounded-lg bg-slate-900 py-1.5 text-[10px] font-semibold text-white">
             App
          </span>
        </div>
      </div>
    </aside>
  );
}
