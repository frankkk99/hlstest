import { NextRequest, NextResponse } from "next/server";
import { fetchAvdbPublicDetail } from "@/lib/avdb-playback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const item = await fetchAvdbPublicDetail(id);
    if (!item) {
      return NextResponse.json({ ok: false, error: "ไม่พบรายการ AVDB นี้" }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, item },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่าน AVDB detail ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
