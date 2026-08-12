import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdminRequest } from "@/lib/admin-api";
import { getCatalogDb, isCatalogConfigured } from "@/lib/hlshub-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  if (!isCatalogConfigured()) return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "รหัสเรื่องไม่ถูกต้อง" }, { status: 400 });
  let body: { isActive?: boolean };
  try { body = (await request.json()) as { isActive?: boolean }; } catch { return NextResponse.json({ ok: false, error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 }); }
  if (typeof body.isActive !== "boolean") return NextResponse.json({ ok: false, error: "ต้องระบุ isActive เป็น boolean" }, { status: 400 });
  const db = getCatalogDb();
  if (!db) return NextResponse.json({ ok: false, error: "ไม่พบฐานข้อมูล catalog" }, { status: 503 });
  const response = await db.from("titles").update({ is_active: body.isActive }).eq("id", id).select("id,is_active").maybeSingle();
  if (response.error) return NextResponse.json({ ok: false, error: response.error.message }, { status: 500 });
  if (!response.data) return NextResponse.json({ ok: false, error: "ไม่พบรายการนี้" }, { status: 404 });
  revalidateTag("hlshub-catalog");
  return NextResponse.json({ ok: true, item: response.data }, { headers: { "Cache-Control": "no-store" } });
}
