import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { runAvdbCrawlerStep } from "@/lib/avdb-runner";
import { isAvdbStagingConfigured } from "@/lib/avdb-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }
  if (!isAvdbStagingConfigured()) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const result = await runAvdbCrawlerStep(body?.runId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AVDB crawler step ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
