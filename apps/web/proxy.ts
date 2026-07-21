import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gate the dashboard: no access cookie → send to /login. The API still validates the token,
// and the page's data loader re-checks — this is just an early redirect.
export function proxy(req: NextRequest) {
  const token = req.cookies.get("gem_access")?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
