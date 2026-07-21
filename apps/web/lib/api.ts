const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type Tokens = { accessToken: string; refreshToken: string };

/** Server-side fetch to the NestJS API. Never import this in a client component. */
export async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;
  return fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: "no-store",
  });
}
