import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { fetchAvdbPlayerState } from "@/lib/avdb-player-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const state = await fetchAvdbPlayerState();
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่าน Player Verification state ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
