import { NextResponse } from "next/server";
import { fetchCatalogDetail, isCatalogConfigured } from "@/lib/hlshub-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isCatalogConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY บน production" },
      { status: 503 },
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "รหัสเรื่องไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const item = await fetchCatalogDetail(id);
    if (!item || !item.hasPlayer) {
      return NextResponse.json({ ok: false, error: "เรื่องนี้ยังไม่มี Player ที่พร้อมรับชม" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่านรายละเอียดไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
