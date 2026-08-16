import type { AvdbScanItem, AvdbScanResult } from "@/lib/avdb-scanner";

const AVDB_API_BASE = "https://avdbapi.com/api.php/provide/vod";
const PAGE_SIZE = 50;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export function buildAvdbApiPageUrl(pageNumber: number) {
  const page = Math.max(1, Math.min(100000, Math.trunc(pageNumber || 1)));
  const url = new URL(AVDB_API_BASE);
  url.searchParams.set("ac", "detail");
  url.searchParams.set("pg", String(page));
  url.searchParams.set("pagesize", String(PAGE_SIZE));
  return url.toString();
}

function getPlayerUrl(item: any): string | null {
  const serverData = item?.episodes?.server_data;
  if (!serverData || typeof serverData !== "object") return null;

  const full = serverData.Full || serverData.full;
  if (full?.link_embed && typeof full.link_embed === "string") return full.link_embed;

  for (const value of Object.values(serverData) as any[]) {
    if (value?.link_embed && typeof value.link_embed === "string") return value.link_embed;
  }
  return null;
}

function providerFromUrl(raw: string | null) {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeItem(item: any, row: number, pageRequestUrl: string, status: number, elapsedMs: number): AvdbScanItem {
  const playerUrl = getPlayerUrl(item);
  const id = item?.id ?? null;
  const apiUrl = id
    ? `${AVDB_API_BASE}?ac=detail&ids=${encodeURIComponent(String(id))}`
    : pageRequestUrl;

  return {
    row,
    apiUrl,
    apiStatus: status,
    apiElapsedMs: elapsedMs,
    id,
    name: String(item?.name ?? ""),
    originalName: String(item?.origin_name ?? item?.original_name ?? item?.original_title ?? ""),
    slug: String(item?.slug ?? ""),
    movieCode: String(item?.movie_code ?? item?.slug ?? ""),
    typeName: String(item?.type_name ?? ""),
    year: String(item?.year ?? ""),
    quality: String(item?.quality ?? ""),
    duration: String(item?.time ?? item?.duration ?? ""),
    description: String(item?.description ?? item?.content ?? ""),
    posterUrl: String(item?.poster_url ?? ""),
    thumbUrl: String(item?.thumb_url ?? ""),
    playerUrl,
    playerProvider: providerFromUrl(playerUrl),
    rawData: item && typeof item === "object" ? (item as Record<string, unknown>) : {},
  };
}

export async function scanAvdbApiPage(pageNumber: number): Promise<AvdbScanResult> {
  const pageUrl = buildAvdbApiPageUrl(pageNumber);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(pageUrl, {
      method: "GET",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": UA,
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    const elapsedMs = Date.now() - started;

    if (!response.ok) {
      return {
        ok: false,
        responseStatus: response.status,
        error: `AVDB API returned HTTP ${response.status}`,
        mode: "chromium",
        pageUrl,
        finalPageUrl: response.url || pageUrl,
        pageStatus: response.status,
        elapsedMs,
      };
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        responseStatus: 502,
        error: "AVDB API response is not JSON",
        mode: "chromium",
        pageUrl,
        finalPageUrl: response.url || pageUrl,
        pageStatus: response.status,
        elapsedMs,
      };
    }

    const rows = Array.isArray(data?.list) ? data.list : [];
    if (!rows.length) {
      return {
        ok: false,
        responseStatus: 422,
        error: `AVDB API page ${pageNumber} returned no items`,
        mode: "chromium",
        pageUrl,
        finalPageUrl: response.url || pageUrl,
        pageStatus: response.status,
        itemsFound: 0,
        elapsedMs,
      };
    }

    const items = rows.map((item: any, index: number) =>
      normalizeItem(item, index + 1, pageUrl, response.status, elapsedMs),
    );

    return {
      ok: true,
      responseStatus: 200,
      mode: "chromium",
      pageUrl,
      finalPageUrl: response.url || pageUrl,
      pageStatus: response.status,
      title: `AVDB API page ${Number(data?.page || pageNumber)} / ${Number(data?.pagecount || 0)}`,
      apiLinksFound: items.length,
      itemsFound: items.length,
      elapsedMs,
      items,
      apiErrors: [],
    };
  } catch (error) {
    return {
      ok: false,
      responseStatus: 500,
      error: error instanceof Error ? error.message : "AVDB API request failed",
      mode: "chromium",
      pageUrl,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}
