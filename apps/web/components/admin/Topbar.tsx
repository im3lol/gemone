import { Bell, ChevronDown, Search } from "lucide-react";

export function AdminTopbar() {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-slate-100 bg-white/90 px-6 py-3 backdrop-blur">
      <div className="relative ml-auto hidden w-full max-w-md sm:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search..."
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-12 text-sm outline-none focus:border-brand-400"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400">
          ⌘K
        </span>
      </div>
      <button className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
        <Bell className="h-5 w-5" />
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
          8
        </span>
      </button>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-lg">🧑‍💼</span>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold text-slate-900">Admin</p>
          <p className="text-xs text-slate-400">Super Admin</p>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </div>
    </header>
  );
}
