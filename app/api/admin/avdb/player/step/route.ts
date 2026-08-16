import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { verifyNextAvdbPlayer } from "@/lib/avdb-player-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const result = await verifyNextAvdbPlayer({
      origin: request.nextUrl.origin,
      includeFailed: body?.includeFailed === true,
      runId: body?.runId ? String(body.runId) : null,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ตรวจ Player queue ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
