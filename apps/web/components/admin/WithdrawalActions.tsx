"use client";

import { useTransition } from "react";
import { approveWithdrawalAction, rejectWithdrawalAction } from "@/app/admin-actions";

export function WithdrawalActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();

  if (status !== "PENDING") {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="flex gap-2">
      <button
        disabled={pending}
        onClick={() => start(() => approveWithdrawalAction(id))}
        className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
      >
        Approve
      </button>
      <button
        disabled={pending}
        onClick={() => start(() => rejectWithdrawalAction(id))}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
      >
        Reject
      </button>
    </div>
  );
}
