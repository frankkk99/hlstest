import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { fetchAdminCatalogPage, isCatalogConfigured, type AdminCatalogFilter } from "@/lib/hlshub-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filters = new Set<AdminCatalogFilter>(["all", "ready", "no-player", "broken", "unknown"]);

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  if (!isCatalogConfigured()) return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });

  const rawFilter = request.nextUrl.searchParams.get("filter") || "all";
  const filter = filters.has(rawFilter as AdminCatalogFilter) ? (rawFilter as AdminCatalogFilter) : "all";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const limit = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 24)));
  const sortParam = request.nextUrl.searchParams.get("sort");
  const sort = sortParam === "title" || sortParam === "release" ? sortParam : "latest";
  const activeParam = request.nextUrl.searchParams.get("active");
  const active = activeParam === "hidden" || activeParam === "all" ? activeParam : "active";

  try {
    const result = await fetchAdminCatalogPage({ page, limit, search: request.nextUrl.searchParams.get("search") || "", sort, filter, active });
    return NextResponse.json({ ok: true, page, limit, filter, active, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "อ่าน catalog ไม่สำเร็จ" }, { status: 500 });
  }
}
