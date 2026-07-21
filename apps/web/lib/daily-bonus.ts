import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type DailyBonusState = {
  streak: number;
  weekDay: number; // 1..7 position in the current cycle
  canClaim: boolean;
  nextClaimAt: string | null;
  todayReward: number;
  rewards: number[];
};

export async function getDailyBonus(): Promise<DailyBonusState> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/daily-bonus", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Daily bonus fetch failed: ${res.status}`);
  return res.json();
}
