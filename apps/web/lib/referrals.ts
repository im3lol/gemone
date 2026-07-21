import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type ReferralData = {
  code: string | null;
  percent: number;
  invited: number;
  commissionPoints: number;
  commissionUsd: string;
};

/** Referral summary for the logged-in user, or redirect to /login if the session is invalid. */
export async function getReferral(): Promise<ReferralData> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/referrals", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Referral fetch failed: ${res.status}`);
  return res.json();
}
