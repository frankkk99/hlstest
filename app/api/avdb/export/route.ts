import { NextRequest, NextResponse } from "next/server";
import { fetchAvdbPublicCatalog, type AvdbPublicCatalogItem } from "@/lib/avdb-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(items: AvdbPublicCatalogItem[]) {
  const columns: Array<keyof AvdbPublicCatalogItem> = [
    "id",
    "stage_item_id",
    "external_id",
    "movie_code",
    "title",
    "original_title",
    "slug",
    "year",
    "quality",
    "duration",
    "description",
    "poster_url",
    "thumb_url",
    "player_provider",
    "categories",
    "published_at",
  ];

  return `\uFEFF${[
    columns.join(","),
    ...items.map((item) => columns.map((column) => csvCell(item[column])).join(",")),
  ].join("\r\n")}`;
}

async function fetchAllActiveAvdb() {
  const items: AvdbPublicCatalogItem[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const result = await fetchAvdbPublicCatalog({ page, limit: 48 });
    items.push(...result.items);
    pageCount = result.pageCount;
    page += 1;
  } while (page <= pageCount);

  return items;
}

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format")?.toLowerCase() === "csv" ? "csv" : "json";
    const items = await fetchAllActiveAvdb();
    const exportedAt = new Date().toISOString();
    const date = exportedAt.slice(0, 10);
    const filename = `avdb_catalog_${items.length}_${date}.${format}`;

    const body = format === "csv"
      ? toCsv(items)
      : JSON.stringify(
          {
            source: "avdbapi",
            exported_at: exportedAt,
            total: items.length,
            note: "Public AVDB catalog snapshot. Secrets, raw diagnostics, player_page_url and verified_media_url are intentionally excluded.",
            items,
          },
          null,
          2,
        );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AVDB export failed" },
      { status: 500 },
    );
  }
}
