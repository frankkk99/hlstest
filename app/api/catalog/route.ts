import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { fetchCatalogPage, isCatalogConfigured } from "@/lib/hlshub-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getCachedCatalogPage = unstable_cache(
  (page: number, limit: number, search: string, sort: "latest" | "release" | "title", readyOnly: boolean) =>
    fetchCatalogPage({ page, limit, search, sort, readyOnly }),
  ["hlshub-catalog-page-v1"],
  { revalidate: 30, tags: ["hlshub-catalog"] },
);

export async function GET(request: NextRequest) {
  if (!isCatalogConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY บน production" },
      { status: 503 },
    );
  }

  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const limit = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 24)));
  const search = request.nextUrl.searchParams.get("search") || "";
  const sortParam = request.nextUrl.searchParams.get("sort");
  const sort = sortParam === "title" || sortParam === "release" ? sortParam : "latest";
  const readyOnly = ["1", "true", "yes"].includes(request.nextUrl.searchParams.get("ready") || "");

  try {
    const result = await getCachedCatalogPage(page, limit, search, sort, readyOnly);
    return NextResponse.json(
      { ok: true, page, limit, readyOnly, ...result },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่าน catalog ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
