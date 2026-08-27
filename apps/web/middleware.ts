import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAllowedMutatingApiRequest } from "@/lib/local-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) {
    return NextResponse.next();
  }
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (isAllowedMutatingApiRequest(origin, referer)) {
    return NextResponse.next();
  }
  return NextResponse.json(
    { error: { code: "forbidden", message: "Local requests only" } },
    { status: 403 },
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
