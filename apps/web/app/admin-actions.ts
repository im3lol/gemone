"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/session";

async function adminPost(path: string) {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api(path, { method: "POST", token });
  if (res.status === 403) redirect("/dashboard");
  return res.ok;
}

export async function approveWithdrawalAction(id: string) {
  await adminPost(`/admin/withdrawals/${id}/approve`);
  revalidatePath("/admin/withdrawals");
  revalidatePath("/admin");
}

export async function rejectWithdrawalAction(id: string) {
  await adminPost(`/admin/withdrawals/${id}/reject`);
  revalidatePath("/admin/withdrawals");
  revalidatePath("/admin");
}

export async function setUserStatusAction(id: string, status: "ACTIVE" | "SUSPENDED") {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  await api(`/admin/fraud/users/${id}/status`, {
    method: "POST",
    token,
    body: JSON.stringify({ status }),
  });
  revalidatePath("/admin/fraud");
  revalidatePath("/admin");
}
