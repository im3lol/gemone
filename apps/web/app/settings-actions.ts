"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/session";

export type SettingsState = { error?: string; ok?: string };

function messageFrom(data: { message?: string | string[] }): string | undefined {
  return Array.isArray(data.message) ? data.message[0] : data.message;
}

export async function updateProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const token = await getAccessToken();
  if (!token) return { error: "Please log in again." };

  const body = {
    displayName: String(formData.get("displayName") ?? "").trim() || undefined,
    country: String(formData.get("country") ?? "").trim().toUpperCase() || undefined,
  };
  const res = await api("/auth/me", { method: "PATCH", token, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { error: messageFrom(data) ?? "Could not update profile." };
  }
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: "Profile updated." };
}

export async function changePasswordAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const token = await getAccessToken();
  if (!token) return { error: "Please log in again." };

  const body = {
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  };
  const res = await api("/auth/change-password", { method: "POST", token, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { error: messageFrom(data) ?? "Could not change password." };
  }
  return { ok: "Password changed." };
}
