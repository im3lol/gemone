import { cookies } from "next/headers";
import type { Tokens } from "./api";

const ACCESS = "gem_access";
const REFRESH = "gem_refresh";

export async function setSession({ accessToken, refreshToken }: Tokens) {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(ACCESS, accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 15 });
  jar.set(REFRESH, refreshToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 7 });
}

export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS)?.value;
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}
