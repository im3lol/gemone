import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type DashboardData = {
  user: { displayName: string | null; level: number; rank: string; xp: number; xpNext: number };
  stats: {
    balance: number;
    balanceUsd: string;
    todaysEarnings: number;
    todaysEarningsUsd: string;
    pending: number;
    pendingUsd: string;
    completedOffers: number;
  };
  recentActivity: { id: string; kind: string; title: string; points: number; createdAt: string }[];
};

/** Fetch dashboard data for the logged-in user, or redirect to /login if the session is invalid. */
export async function getDashboard(): Promise<DashboardData> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/dashboard", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
  return res.json();
}
