"use client";

import { useActionState } from "react";
import { createWithdrawalAction, type WithdrawState } from "@/app/withdraw-actions";
import { MIN_WITHDRAWAL_POINTS, WITHDRAWAL_METHODS } from "@/lib/withdrawal-constants";

export function WithdrawForm({ balance }: { balance: number }) {
  const [state, action, pending] = useActionState<WithdrawState, FormData>(
    createWithdrawalAction,
    {},
  );

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Request a withdrawal</h2>
      <p className="mt-1 text-sm text-slate-500">
        Minimum {MIN_WITHDRAWAL_POINTS.toLocaleString()} points. Your first payout is reviewed manually.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Amount (points)</span>
          <input
            name="points"
            type="number"
            min={MIN_WITHDRAWAL_POINTS}
            max={balance}
            step={100}
            defaultValue={MIN_WITHDRAWAL_POINTS}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <span className="mt-1 block text-xs text-slate-400">Available: {balance.toLocaleString()} points</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Method</span>
          <select
            name="method"
            defaultValue="paypal"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          >
            {WITHDRAWAL_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Payout email / account</span>
          <input
            name="destination"
            type="text"
            placeholder="you@paypal.com"
            required
            minLength={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
        )}
        {state.ok && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
            Withdrawal requested — points were deducted and it&apos;s now being processed.
          </p>
        )}

        <button
          type="submit"
          disabled={pending || balance < MIN_WITHDRAWAL_POINTS}
          className="w-full rounded-full bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
        >
          {pending ? "Requesting…" : "Withdraw"}
        </button>
      </form>
    </div>
  );
}
