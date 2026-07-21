"use client";

import Link from "next/link";
import { useActionState } from "react";
import { GemMark } from "@/components/ui/Logo";
import type { AuthState } from "@/app/auth-actions";

type Action = (prev: AuthState, formData: FormData) => Promise<AuthState>;

export function AuthForm({
  mode,
  action,
  referralCode,
}: {
  mode: "login" | "signup";
  action: Action;
  referralCode?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
      <div className="flex flex-col items-center text-center">
        <GemMark className="h-11 w-11" />
        <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isSignup ? "Start earning rewards in seconds." : "Log in to continue earning."}
        </p>
      </div>

      {isSignup && referralCode && (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-center text-xs font-medium text-brand-700">
          🎁 You were invited! You&apos;ll both start earning together.
        </p>
      )}

      <form action={formAction} className="mt-6 space-y-4">
        {isSignup && referralCode && <input type="hidden" name="referralCode" value={referralCode} />}
        {isSignup && (
          <Field label="Display name" name="displayName" type="text" placeholder="Ashley Morgan" required={false} />
        )}
        <Field label="Email" name="email" type="email" placeholder="you@example.com" required />
        <Field label="Password" name="password" type="password" placeholder="••••••••" required minLength={isSignup ? 8 : undefined} />

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
        >
          {pending ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        {isSignup ? "Already have an account? " : "New to GemOne? "}
        <Link href={isSignup ? "/login" : "/signup"} className="font-semibold text-brand-600">
          {isSignup ? "Log in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  placeholder,
  required,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  placeholder: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
