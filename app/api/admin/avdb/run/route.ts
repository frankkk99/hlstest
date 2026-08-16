import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { controlAvdbRun, createAvdbRun, isAvdbStagingConfigured } from "@/lib/avdb-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }
  if (!isAvdbStagingConfigured()) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const action = String(body?.action || "start").trim().toLowerCase();

    if (action === "start") {
      const run = await createAvdbRun({
        startPage: body?.startPage,
        endPage: body?.endPage,
        concurrency: body?.concurrency,
        retryLimit: body?.retryLimit,
      });
      return NextResponse.json({
        ok: true,
        run,
        crawlerConnected: true,
        message: `สร้าง Run หน้า ${run.start_page}-${run.end_page} แล้ว Crawler จะเริ่มจากหน้า ${run.current_page}`,
      });
    }

    const run = await controlAvdbRun({
      runId: body?.runId,
      action,
      checkpointPage: body?.checkpointPage,
      currentPage: body?.currentPage,
      lastError: body?.lastError,
    });

    return NextResponse.json({ ok: true, run, crawlerConnected: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ควบคุม AVDB run ไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
