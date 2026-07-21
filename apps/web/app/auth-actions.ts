"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { clearSession, setSession } from "@/lib/session";

export type AuthState = { error?: string };

async function authenticate(path: "/auth/login" | "/auth/signup", body: Record<string, unknown>): Promise<AuthState> {
  const res = await api(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = Array.isArray(data.message) ? data.message[0] : data.message;
    return { error: msg ?? "Something went wrong. Please try again." };
  }
  const { accessToken, refreshToken } = await res.json();
  await setSession({ accessToken, refreshToken });
  return {};
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await authenticate("/auth/login", {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (result.error) return result;
  redirect("/dashboard");
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await authenticate("/auth/signup", {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || undefined,
    referralCode: String(formData.get("referralCode") ?? "") || undefined,
  });
  if (result.error) return result;
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
