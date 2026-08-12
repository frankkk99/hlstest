import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdminRequest } from "@/lib/admin-api";
import { getCatalogDb, isCatalogConfigured } from "@/lib/hlshub-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "show-only-passed" | "repair-failed";

function idsOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0))].slice(0, 500);
}

async function setVisibility(db: NonNullable<ReturnType<typeof getCatalogDb>>, ids: number[], isActive: boolean) {
  if (!ids.length) return 0;
  const response = await db.from("titles").update({ is_active: isActive }).in("id", ids).select("id");
  if (response.error) throw new Error(response.error.message);
  return response.data?.length || ids.length;
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  if (!isCatalogConfigured()) return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });

  let body: { action?: Action; ids?: unknown; passedIds?: unknown; failedIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "ข้อมูลคำสั่งไม่ถูกต้อง" }, { status: 400 });
  }

  if (body.action !== "show-only-passed" && body.action !== "repair-failed") {
    return NextResponse.json({ ok: false, error: "ไม่รู้จักคำสั่งหลังเทส" }, { status: 400 });
  }

  const ids = idsOf(body.ids);
  const passedIds = idsOf(body.passedIds).filter((id) => ids.includes(id));
  const failedIds = idsOf(body.failedIds).filter((id) => ids.includes(id));
  if (!ids.length) return NextResponse.json({ ok: false, error: "ไม่พบรายการสำหรับทำรายการ" }, { status: 400 });

  const db = getCatalogDb();
  if (!db) return NextResponse.json({ ok: false, error: "ไม่พบฐานข้อมูล catalog" }, { status: 503 });

  try {
    let shown = 0;
    let movedToRepair = 0;
    if (body.action === "show-only-passed") {
      const notPassed = ids.filter((id) => !passedIds.includes(id));
      shown = await setVisibility(db, passedIds, true);
      movedToRepair = await setVisibility(db, notPassed, false);
    } else {
      movedToRepair = await setVisibility(db, failedIds, false);
    }

    revalidateTag("hlshub-catalog");
    return NextResponse.json({ ok: true, updated: { shown, movedToRepair } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ทำรายการหลังเทสไม่สำเร็จ" }, { status: 500 });
  }
}
