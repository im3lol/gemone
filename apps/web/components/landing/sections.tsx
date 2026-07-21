import { ArrowRight, DollarSign, Gift, Headphones, Shield, Star, Zap } from "lucide-react";
import {
  features,
  landingStats,
  partners,
  steps,
  testimonials,
  waysToEarn,
} from "@/lib/data";

const featureIcons: Record<string, React.ElementType> = {
  gift: Gift,
  dollar: DollarSign,
  shield: Shield,
  zap: Zap,
  headset: Headphones,
};

export function Partners() {
  return (
    <section className="border-y border-slate-100 bg-white py-10">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center text-sm font-medium text-slate-400">Trusted by top offer partners</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {partners.map((p) => (
            <span key={p} className="text-lg font-semibold text-slate-300">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto grid max-w-6xl gap-5 px-6 sm:grid-cols-2 lg:grid-cols-5">
        {features.map((f) => {
          const Icon = featureIcons[f.icon];
          return (
            <div key={f.title} className="rounded-2xl border border-slate-100 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-500 text-white">
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-slate-900">{f.title}</h3>
              <p className="mt-1 text-xs text-slate-500">{f.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <h2 className="font-display text-3xl font-bold text-slate-900">How GemOne Works</h2>
        <p className="mt-2 text-slate-500">Start earning in 3 simple steps</p>
        <div className="mt-12 flex flex-col items-start justify-center gap-8 md:flex-row">
          {steps.map((s, i) => (
            <div key={s.n} className="flex flex-1 flex-col items-center">
              <div className="relative grid h-28 w-28 place-items-center rounded-full bg-brand-50 text-5xl">
                {s.emoji}
                <span className="absolute -top-1 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full bg-brand-500 text-sm font-bold text-white">
                  {s.n}
                </span>
              </div>
              <h3 className="mt-5 font-bold text-slate-900">{s.title}</h3>
              <p className="mt-1 max-w-[200px] text-sm text-slate-500">{s.text}</p>
              {i < steps.length - 1 && (
                <ArrowRight className="mt-4 hidden h-5 w-5 text-brand-300 md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WaysToEarn() {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <h2 className="font-display text-3xl font-bold text-slate-900">Many Ways to Earn</h2>
        <p className="mt-2 text-slate-500">Choose what you like and start earning</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
          {waysToEarn.map((w) => (
            <div key={w.title} className={`rounded-2xl p-5 text-center ${w.tint}`}>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/70 text-3xl shadow-sm">
                {w.emoji}
              </div>
              <h3 className="mt-4 text-sm font-bold text-slate-900">{w.title}</h3>
              <p className="mt-1 text-xs text-slate-500">{w.text}</p>
              <button className={`mt-4 w-full rounded-lg py-1.5 text-xs font-semibold ${w.btn}`}>Explore</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Testimonials() {
  return (
    <section className="bg-gradient-to-b from-brand-50/70 to-brand-50/30 py-16">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <h2 className="font-display text-3xl font-bold text-slate-900">Loved by Our Community</h2>
        <p className="mt-2 text-slate-500">See what our users are saying</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <div key={t.name} className="rounded-2xl border border-slate-100 bg-white p-6 text-left shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-200 text-lg">🙂</span>
                <div>
                  <p className="flex items-center gap-1 text-sm font-bold text-slate-900">
                    {t.name}
                    <span className="text-brand-500">✔</span>
                  </p>
                  <div className="flex text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="h-3.5 w-3.5 fill-current" />
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <div>
                  <p className="text-sm font-bold" style={{ color: t.color }}>
                    Received {t.amount}
                  </p>
                  <p className="text-xs text-slate-400">via {t.via}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StatsBar() {
  return (
    <section className="bg-white pb-4 pt-8">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-6 rounded-3xl bg-gradient-to-r from-brand-800 to-brand-950 px-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {landingStats.map((s) => (
            <div key={s.label} className="text-center text-white">
              <p className="font-display text-3xl font-extrabold">{s.value}</p>
              <p className="mt-1 text-sm text-brand-100/80">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBanner() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center gap-6 rounded-3xl bg-brand-50 px-8 py-10 text-center md:flex-row md:justify-between md:text-left">
          <div className="flex items-center gap-5">
            <span className="text-6xl">🧰</span>
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-900">Ready to start earning?</h2>
              <p className="mt-1 text-slate-500">Join thousands of users who earn rewards every day.</p>
            </div>
          </div>
          <div className="text-center">
            <a
              href="#"
              className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-7 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-600"
            >
              Sign up for free <ArrowRight className="h-4 w-4" />
            </a>
            <p className="mt-2 text-xs text-slate-400">It takes less than 30 seconds!</p>
          </div>
        </div>
      </div>
    </section>
  );
}
