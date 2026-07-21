"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/session";

export type WithdrawState = { error?: string; ok?: boolean };

export async function createWithdrawalAction(
  _prev: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  const token = await getAccessToken();
  if (!token) redirect("/login");

  const res = await api("/withdrawals", {
    method: "POST",
    token,
    body: JSON.stringify({
      method: String(formData.get("method") ?? ""),
      destination: String(formData.get("destination") ?? ""),
      points: Number(formData.get("points") ?? 0),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = Array.isArray(data.message) ? data.message[0] : data.message;
    return { error: msg ?? "Withdrawal failed. Please try again." };
  }

  revalidatePath("/withdraw");
  revalidatePath("/dashboard");
  return { ok: true };
}
