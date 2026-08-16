import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { previewAvdbIdsFromHtml } from "@/lib/avdb-html-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await previewAvdbIdsFromHtml(body?.ids);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่าน Preview AVDB ไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
