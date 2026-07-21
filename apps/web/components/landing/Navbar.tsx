import { ChevronDown } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

const links = ["How it works", "Earn", "Rewards", "Blog", "Support"];

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          {links.map((l) => (
            <a key={l} href="#" className="flex items-center gap-1 transition hover:text-slate-900">
              {l}
              {l === "Earn" && <ChevronDown className="h-3.5 w-3.5" />}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href="/login" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block">
            Log in
          </a>
          <a
            href="/signup"
            className="rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
          >
            Sign up
          </a>
        </div>
      </div>
    </header>
  );
}
