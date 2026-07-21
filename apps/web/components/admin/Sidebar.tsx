import {
  ArrowDownToLine,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ClipboardList,
  CreditCard,
  Fingerprint,
  Gift,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  type LucideIcon,
  Menu,
  ScrollText,
  Settings,
  Share2,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

type Item = { icon: LucideIcon; label: string; href?: string };
type Group = { title: string; items: Item[] };

const groups: Group[] = [
  {
    title: "Main",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", href: "/admin" },
      { icon: Users, label: "Users", href: "/admin/users" },
      { icon: Gift, label: "Offers" },
      { icon: LayoutGrid, label: "Offerwalls" },
      { icon: ClipboardList, label: "Surveys" },
      { icon: Boxes, label: "Providers" },
    ],
  },
  {
    title: "Financial",
    items: [
      { icon: Wallet, label: "Wallets" },
      { icon: BookOpen, label: "Ledger" },
      { icon: ArrowDownToLine, label: "Withdrawals", href: "/admin/withdrawals" },
      { icon: ArrowLeftRight, label: "Transactions" },
      { icon: Banknote, label: "Payouts" },
    ],
  },
  {
    title: "Risk & Security",
    items: [
      { icon: ShieldAlert, label: "Fraud Detection", href: "/admin/fraud" },
      { icon: Globe, label: "IP Monitoring" },
      { icon: Fingerprint, label: "Device Fingerprints" },
      { icon: CreditCard, label: "Chargebacks" },
    ],
  },
  {
    title: "Engagement",
    items: [
      { icon: Share2, label: "Referrals" },
      { icon: Trophy, label: "Achievements" },
      { icon: Bell, label: "Notifications" },
      { icon: LifeBuoy, label: "Support Tickets" },
    ],
  },
  {
    title: "System",
    items: [
      { icon: BarChart3, label: "Reports" },
      { icon: ScrollText, label: "Audit Logs" },
      { icon: Settings, label: "Settings" },
    ],
  },
];

export function AdminSidebar({ current = "Dashboard" }: { current?: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-100 bg-white lg:flex">
      <div className="flex items-center justify-between px-5 py-4">
        <Logo textClass="text-lg font-bold text-slate-900" />
        <Menu className="h-5 w-5 text-slate-400" />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto no-scrollbar px-3 pb-6">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g.title}
            </p>
            <div className="mt-1 space-y-0.5">
              {g.items.map((i) => {
                const active = i.label === current;
                const cls = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`;
                return i.href ? (
                  <Link key={i.label} href={i.href} className={cls}>
                    <i.icon className="h-[18px] w-[18px]" />
                    {i.label}
                  </Link>
                ) : (
                  <a key={i.label} href="#" className={cls}>
                    <i.icon className="h-[18px] w-[18px]" />
                    {i.label}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
