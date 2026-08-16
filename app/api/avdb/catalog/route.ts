import { NextRequest, NextResponse } from "next/server";
import { fetchAvdbPublicCatalog } from "@/lib/avdb-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await fetchAvdbPublicCatalog({
      page: request.nextUrl.searchParams.get("page"),
      limit: request.nextUrl.searchParams.get("limit"),
      search: request.nextUrl.searchParams.get("q"),
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่าน AVDB catalog ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
