import { ArrowRight, Play, Star } from "lucide-react";

// ponytail: phone + floating props are CSS/emoji placeholders, swap for real 3D renders

function PhoneMockup() {
  const activity = [
    { emoji: "🎮", label: "Game Mission", pts: "+1,200" },
    { emoji: "📋", label: "Survey completed", pts: "+800" },
    { emoji: "📱", label: "App install", pts: "+1,000" },
    { emoji: "▶️", label: "Video watched", pts: "+200" },
  ];
  return (
    <div className="relative mx-auto w-[280px] rounded-[2.5rem] border-[10px] border-slate-900 bg-white shadow-2xl">
      <div className="absolute left-1/2 top-0 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
      <div className="space-y-4 p-4 pt-8">
        <p className="text-sm font-semibold text-slate-800">
          Hi, Ashley! <span>👋</span>
        </p>
        <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white">
          <p className="text-xs text-white/80">Your Balance</p>
          <p className="text-3xl font-bold">12,560</p>
          <p className="text-xs text-white/80">Points · ≈ $512.56</p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-500">Recent activity</p>
          <div className="space-y-2">
            {activity.map((a) => (
              <div key={a.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-100 text-[11px]">{a.emoji}</span>
                  {a.label}
                </span>
                <span className="text-xs font-bold text-brand-600">{a.pts}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-around border-t border-slate-100 pt-3 text-[10px] text-slate-400">
          <span className="font-semibold text-brand-600">Home</span>
          <span>Earn</span>
          <span>Wallet</span>
          <span>Profile</span>
        </div>
      </div>
    </div>
  );
}

function FloatProp({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`absolute grid place-items-center rounded-2xl shadow-lg ${className}`}>{children}</div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-brand-50/60 to-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
        {/* Left */}
        <div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            Earn Rewards.
            <br />
            Your Way.
            <br />
            <span className="text-brand-500">Anytime, Anywhere.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-slate-500">
            Complete offers, play games, take surveys and earn real rewards. Turn your time into real value with GemOne.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#"
              className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-600"
            >
              Start earning now <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Play className="h-4 w-4" /> How it works
            </a>
          </div>
          <div className="mt-8 flex items-center gap-3">
            <div className="flex -space-x-2">
              {["👩", "🧑", "👨"].map((e, i) => (
                <span key={i} className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-slate-200 text-sm">
                  {e}
                </span>
              ))}
            </div>
            <div>
              <div className="flex text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="text-sm font-medium text-slate-500">30,000+ happy users</p>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="relative mx-auto h-[520px] w-full max-w-sm">
          <PhoneMockup />
          <FloatProp className="left-0 top-8 h-16 w-16 rotate-[-12deg] bg-amber-100 text-3xl">🎁</FloatProp>
          <FloatProp className="bottom-16 left-2 h-16 w-16 rotate-6 bg-brand-100 text-3xl">🎮</FloatProp>
          <FloatProp className="right-2 top-16 h-14 w-20 rotate-6 bg-[#003087] text-xs font-bold text-white">PayPal</FloatProp>
          <FloatProp className="bottom-24 right-0 h-14 w-20 -rotate-6 bg-slate-900 text-xs font-bold text-white">amazon</FloatProp>
          <FloatProp className="bottom-4 right-10 h-14 w-14 bg-amber-300 text-2xl">🪙</FloatProp>
          <span className="absolute right-16 top-4 text-2xl text-brand-400">✦</span>
          <span className="absolute left-8 top-40 text-xl text-brand-300">✦</span>
        </div>
      </div>
    </section>
  );
}
