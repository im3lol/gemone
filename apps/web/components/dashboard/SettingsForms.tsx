"use client";

import { useActionState } from "react";
import { changePasswordAction, updateProfileAction, type SettingsState } from "@/app/settings-actions";
import type { Me } from "@/lib/me";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";

function Notice({ state }: { state: SettingsState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{state.ok}</p>;
  return null;
}

export function ProfileForm({ me }: { me: Me }) {
  const [state, action, pending] = useActionState(updateProfileAction, {});
  return (
    <form action={action} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Profile</h2>
      <p className="text-sm text-slate-500">Update your public details.</p>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input value={me.email} disabled className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Display name</span>
          <input name="displayName" defaultValue={me.displayName ?? ""} placeholder="Your name" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Country (ISO-2)</span>
          <input name="country" defaultValue={me.country ?? ""} maxLength={2} placeholder="US" className={`${inputCls} uppercase`} />
        </label>
        <Notice state={state} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Password</h2>
      <p className="text-sm text-slate-500">Changing it logs out your other sessions.</p>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Current password</span>
          <input name="currentPassword" type="password" required placeholder="••••••••" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">New password</span>
          <input name="newPassword" type="password" required minLength={8} placeholder="At least 8 characters" className={inputCls} />
        </label>
        <Notice state={state} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {pending ? "Updating…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
