import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { importAvdbIdsFromHtml } from "@/lib/avdb-html-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await importAvdbIdsFromHtml(body?.ids, body?.sourceName, body?.sourcePage);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `อ่าน API ได้ ${result.fetched}/${result.requested} · ใหม่ ${result.inserted} · อัปเดต ${result.updated} · ซ้ำ ${result.duplicates}`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "นำเข้า AVDB จากไฟล์ไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
