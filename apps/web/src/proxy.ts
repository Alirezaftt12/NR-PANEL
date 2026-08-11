import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("nr_session")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admins/:path*", "/security/:path*", "/users/:path*", "/subpanels/:path*", "/configs/:path*", "/subscriptions/:path*", "/servers/:path*", "/xray/:path*", "/inbounds/:path*", "/protocols/:path*", "/traffic/:path*", "/monitor/:path*", "/logs/:path*", "/backups/:path*", "/settings/:path*", "/notifications/:path*"],
};
