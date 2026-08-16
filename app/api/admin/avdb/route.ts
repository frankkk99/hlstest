import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { fetchAvdbAdminState, isAvdbStagingConfigured } from "@/lib/avdb-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }
  if (!isAvdbStagingConfigured()) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const state = await fetchAvdbAdminState();
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่านสถานะ AVDB ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
