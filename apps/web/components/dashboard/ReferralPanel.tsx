"use client";

import { useState } from "react";
import type { ReferralData } from "@/lib/referrals";

export function ReferralPanel({ referral }: { referral: ReferralData }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const link =
    referral.code && typeof window !== "undefined"
      ? `${window.location.origin}/signup?ref=${referral.code}`
      : "";

  async function copy(text: string, which: "link" | "code") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — the value stays visible to copy manually */
    }
  }

  const steps = [
    { emoji: "🔗", title: "Share your link", text: "Send your referral link to friends." },
    { emoji: "🎮", title: "They earn", text: "They sign up and complete offers." },
    { emoji: "💰", title: "You earn", text: `You get ${referral.percent}% of everything they earn — forever.` },
  ];

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🎁</span>
          <div>
            <h2 className="text-xl font-bold">Invite friends, earn {referral.percent}%</h2>
            <p className="text-sm text-white/80">Earn {referral.percent}% of your friends&apos; earnings, for life.</p>
          </div>
        </div>

        {referral.code ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/15 px-4 py-3">
              <code className="flex-1 truncate text-sm font-semibold">{link || referral.code}</code>
            </div>
            <button
              onClick={() => copy(link, "link")}
              className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-700 hover:bg-white/90"
            >
              {copied === "link" ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={() => copy(referral.code!, "code")}
              className="rounded-xl bg-white/15 px-5 py-3 text-sm font-bold text-white hover:bg-white/25"
            >
              {copied === "code" ? "Copied!" : `Code: ${referral.code}`}
            </button>
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-white/15 px-4 py-3 text-sm">Your referral code is being generated — check back shortly.</p>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Friends invited" value={referral.invited.toLocaleString()} />
        <Stat label="Commission earned" value={`$${referral.commissionUsd}`} accent="text-brand-600" />
        <Stat label="Your rate" value={`${referral.percent}%`} />
      </div>

      {/* How it works */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h3 className="font-bold text-slate-900">How it works</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-xl bg-slate-50 p-4">
              <span className="text-2xl">{s.emoji}</span>
              <p className="mt-2 text-sm font-bold text-slate-900">
                {i + 1}. {s.title}
              </p>
              <p className="mt-1 text-xs text-slate-500">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}
