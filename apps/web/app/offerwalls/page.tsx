import Link from "next/link";
import { PageShell } from "@/components/dashboard/PageShell";
import { getMe } from "@/lib/me";
import { adgemWall } from "@/lib/offerwall";

export const metadata = { title: "Offerwalls — GemOne" };

export default async function OfferwallsPage() {
  const me = await getMe();
  const walls = [adgemWall(me.id)];

  return (
    <PageShell
      current="Offerwalls"
      title="Offerwalls"
      subtitle="Every offer network in one place. Pick a wall and start earning."
    >
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {walls.map((w) => (
          <Link
            key={w.key}
            href="/earn"
            className="group rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition hover:border-brand-200 hover:shadow-md"
          >
            <div
              className="grid h-14 w-14 place-items-center rounded-2xl text-xl font-bold text-white"
              style={{ background: w.color }}
            >
              {w.name[0]}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{w.name}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  w.configured ? "bg-brand-50 text-brand-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {w.configured ? "Live" : "Setup needed"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{w.blurb}</p>
            <span className="mt-4 inline-block text-sm font-semibold text-brand-600 group-hover:underline">
              Open wall →
            </span>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
