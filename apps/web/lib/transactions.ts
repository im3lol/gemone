import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type LedgerEntry = {
  id: string;
  points: number;
  type: "BONUS" | "EARN" | "WITHDRAWAL" | "REVERSAL" | "ADJUSTMENT";
  reference: string | null;
  createdAt: string;
};

export async function getTransactions(): Promise<LedgerEntry[]> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/transactions", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Transactions fetch failed: ${res.status}`);
  return res.json();
}
