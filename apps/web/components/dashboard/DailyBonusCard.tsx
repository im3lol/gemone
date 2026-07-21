"use client";

import { useState, useTransition } from "react";
import { claimDailyBonus } from "@/app/daily-bonus-actions";
import type { DailyBonusState } from "@/lib/daily-bonus";

export function DailyBonusCard({ state }: { state: DailyBonusState }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Days already completed this 7-day cycle (before today's pending claim).
  const claimedInCycle = state.canClaim ? state.weekDay - 1 : state.weekDay;

  function claim() {
    setMsg(null);
    startTransition(async () => {
      const r = await claimDailyBonus();
      setMsg(r.error ? r.error : `+${r.reward} points claimed! 🎉`);
    });
  }

  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50 p-5">
      <div className="flex flex-col items-center gap-4 md:flex-row">
        <span className="text-4xl">💎</span>
        <div className="flex-1 text-center md:text-left">
          <p className="font-bold text-slate-900">Daily Bonus</p>
          <p className="text-sm text-slate-500">
            {state.streak > 0 ? `${state.streak}-day streak — keep it alive!` : "Claim your daily bonus to start a streak!"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Day {state.weekDay} of 7</span>
          {state.rewards.map((_, i) => {
            const d = i + 1;
            const done = d <= claimedInCycle;
            const today = state.canClaim && d === claimedInCycle + 1;
            return (
              <span
                key={d}
                title={`${state.rewards[i]} pts`}
                className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                  done
                    ? "bg-brand-500 text-white"
                    : today
                      ? "bg-brand-100 text-brand-700 ring-2 ring-brand-400"
                      : "border border-slate-200 bg-white text-slate-400"
                }`}
              >
                {done ? "✓" : d}
              </span>
            );
          })}
        </div>

        <button
          onClick={claim}
          disabled={!state.canClaim || pending}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Claiming…" : state.canClaim ? `Claim ${state.todayReward} Points` : "Claimed ✓"}
        </button>
      </div>

      {msg && <p className="mt-3 text-center text-sm font-medium text-brand-700 md:text-right">{msg}</p>}
      {!state.canClaim && !msg && (
        <p className="mt-3 text-center text-xs text-slate-400 md:text-right">Come back tomorrow for your next bonus.</p>
      )}
    </div>
  );
}
