import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { verifyAvdbPlayerItem } from "@/lib/avdb-player-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const itemId = String(body?.itemId || "").trim();
    if (!itemId) {
      return NextResponse.json({ ok: false, error: "ไม่พบ itemId" }, { status: 400 });
    }

    const result = await verifyAvdbPlayerItem({
      itemId,
      origin: request.nextUrl.origin,
      forceFresh: body?.forceFresh !== false,
    });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ตรวจ Player ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
