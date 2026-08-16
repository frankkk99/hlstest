import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { captureAvdbRunFatal } from "@/lib/avdb-run-fatal";
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

  let runId = "";
  try {
    const body = await request.json();
    runId = String(body?.runId || "").trim();
    const result = await runAvdbCrawlerStep(runId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AVDB crawler step ไม่สำเร็จ";
    console.error("[avdb-run-step]", { runId, message, error });
    await captureAvdbRunFatal(runId, error).catch((captureError) => {
      console.error("[avdb-run-step:capture]", captureError);
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
