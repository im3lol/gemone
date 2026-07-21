import { redirect } from "next/navigation";
import { api } from "./api";
import { getAccessToken } from "./session";

export type Me = {
  id: string;
  email: string;
  displayName: string | null;
  level: number;
  xp: number;
  country?: string | null;
};

/** The logged-in user's account, or redirect to /login if the session is invalid. */
export async function getMe(): Promise<Me> {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const res = await api("/auth/me", { token });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
  return res.json();
}
