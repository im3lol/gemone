import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type Offer = {
  id: string;
  provider: string;
  title: string;
  description: string;
  points: number;
  payoutUsd: string;
  category: "game" | "survey" | "app" | "signup" | "shopping" | "video";
  difficulty: "Easy" | "Medium" | "Hard";
  icon: string;
  color: string;
  clickUrl: string;
  countries: string[];
};

/** Aggregated offers from all enabled providers for the logged-in user. */
export async function getOffers(): Promise<Offer[]> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/offers", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Offers fetch failed: ${res.status}`);
  const data = (await res.json()) as { offers: Offer[] };
  return data.offers;
}
