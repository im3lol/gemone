import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";
import type { Withdrawal } from "./withdrawal-constants";

export * from "./withdrawal-constants";

/** The logged-in user's withdrawal history. */
export async function getWithdrawals(): Promise<Withdrawal[]> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/withdrawals", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Withdrawals fetch failed: ${res.status}`);
  return res.json();
}
