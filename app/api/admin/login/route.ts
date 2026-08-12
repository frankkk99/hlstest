import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken, verifyAdminPassword } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { password?: string; next?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  if (!(await verifyAdminPassword(String(body.password || "")))) {
    return NextResponse.json({ ok: false, error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    next: typeof body.next === "string" && body.next.startsWith("/admin") ? body.next : "/admin",
  });
  response.cookies.set(ADMIN_SESSION_COOKIE, await createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
