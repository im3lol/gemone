"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/session";

export type ClaimResult = { reward?: number; error?: string };

export async function claimDailyBonus(): Promise<ClaimResult> {
  const token = await getAccessToken();
  if (!token) return { error: "Please log in again." };
  const res = await api("/daily-bonus/claim", { method: "POST", token });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = Array.isArray(data.message) ? data.message[0] : data.message;
    return { error: msg ?? "Could not claim your bonus." };
  }
  const data = await res.json();
  // Refresh anything that shows the balance or bonus state.
  revalidatePath("/dashboard");
  revalidatePath("/daily-bonus");
  return { reward: data.reward as number };
}
