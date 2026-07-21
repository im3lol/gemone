"use client";

import { useState } from "react";
import type { ReferralData } from "@/lib/referrals";

export function ReferralCard({ referral }: { referral: ReferralData }) {
  const [copied, setCopied] = useState(false);

  // Build the share link on the client so it uses the current origin.
  const link =
    referral.code && typeof window !== "undefined"
      ? `${window.location.origin}/signup?ref=${referral.code}`
      : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure origin / permissions) — leave the code visible to copy manually.
    }
  }

  return (
    <div className="rounded-2xl bg-brand-50 p-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="font-bold text-slate-900">Referral Program</p>
          <p className="mt-1 text-xs text-slate-500">
            Invite friends and earn {referral.percent}% of their earnings
          </p>
        </div>
        <span className="text-4xl">🎁</span>
      </div>

      <div className="mt-3 flex gap-4 text-center">
        <div className="flex-1 rounded-xl bg-white/70 py-2">
          <p className="text-lg font-bold text-slate-900">{referral.invited}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Invited</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/70 py-2">
          <p className="text-lg font-bold text-brand-600">${referral.commissionUsd}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Earned</p>
        </div>
      </div>

      {referral.code && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-2">
          <code className="flex-1 truncate text-xs font-semibold text-slate-700">{referral.code}</code>
          <button
            onClick={copy}
            className="rounded-md bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
