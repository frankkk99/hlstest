import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { createAvdbIncrementalRun, getAvdbIncrementalState } from "@/lib/avdb-more-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const state = await getAvdbIncrementalState();
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่านสถานะดึงเพิ่มไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await createAvdbIncrementalRun(body || {});
    return NextResponse.json({
      ok: true,
      ...result,
      message: `เริ่มดึงเพิ่มหน้า ${result.startPage}-${result.endPage} (${result.pagesRequested} หน้า) แล้ว`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "สร้าง Run ดึงเพิ่มไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
