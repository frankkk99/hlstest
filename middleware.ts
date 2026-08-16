import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "@/lib/admin-auth";

const legacyTools: Record<string, string> = {
  "/bulk-player-test": "/admin/bulk-player-test",
  "/avdb-import-test": "/admin/avdb-import-test",
  "/player-extractor": "/admin/player-extractor",
  "/embed-test": "/admin/embed-test",
};

const adminTools: Record<string, string> = {
  "/admin/hls-test": "/hls-test",
  "/admin/avdb-import-test": "/avdb-import-test",
  "/admin/bulk-player-test": "/bulk-player-test",
  "/admin/player-extractor": "/player-extractor",
  "/admin/embed-test": "/embed-test",
};

function copySearch(source: NextRequest, destination: URL) {
  destination.search = source.nextUrl.search;
  return destination;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (legacyTools[pathname]) {
    return NextResponse.redirect(copySearch(request, new URL(legacyTools[pathname], request.url)));
  }

  if (pathname === "/admin/login") return NextResponse.next();

  if (adminTools[pathname]) {
    const expected = await createAdminSessionToken();
    const provided = request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    if (!expected || provided !== expected) {
      const login = new URL("/admin/login", request.url);
      login.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(login);
    }
    return NextResponse.rewrite(copySearch(request, new URL(adminTools[pathname], request.url)));
  }

  if (pathname.startsWith("/admin/")) {
    const expected = await createAdminSessionToken();
    const provided = request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    if (expected && provided === expected) return NextResponse.next();
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (pathname === "/admin") {
    const expected = await createAdminSessionToken();
    const provided = request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
    if (expected && provided === expected) return NextResponse.next();
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", "/admin");
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/login",
    "/admin/:path*",
    "/bulk-player-test",
    "/avdb-import-test",
    "/player-extractor",
    "/embed-test",
  ],
};
