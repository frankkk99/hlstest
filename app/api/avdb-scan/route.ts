import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

function allowedAvdbUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "avdbapi.com" || host === "www.avdbapi.com");
  } catch {
    return false;
  }
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractApiLinks(html: string, pageUrl: string) {
  const found = new Set<string>();
  const anchor = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html))) {
    const href = match[2];
    const text = stripTags(match[4]).toLowerCase();
    const attrs = `${match[1]} ${match[3]}`.toLowerCase();
    const looksApi = text === "api" || text.startsWith("api ") || /\bapi\b/.test(attrs) || /\/api(?:[/?._-]|$)/i.test(href);
    if (!looksApi) continue;

    try {
      const absolute = new URL(href, pageUrl).toString();
      if (allowedAvdbUrl(absolute)) found.add(absolute);
    } catch {
      // Ignore malformed links.
    }
  }

  // Fallback for pages where the API URL is placed in JS/data attributes instead of anchor text.
  if (!found.size) {
    const rawUrl = /(?:https?:\/\/avdbapi\.com)?\/[A-Za-z0-9_./?=&%-]*api[A-Za-z0-9_./?=&%-]*/gi;
    for (const value of html.match(rawUrl) || []) {
      try {
        const absolute = new URL(value, pageUrl).toString();
        if (allowedAvdbUrl(absolute)) found.add(absolute);
      } catch {
        // Ignore malformed links.
      }
    }
  }

  return [...found];
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

async function loadApi(apiUrl: string) {
  const started = Date.now();
  try {
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        apiUrl,
        ok: false,
        status: response.status,
        elapsedMs: Date.now() - started,
        error: "API response is not JSON",
      };
    }

    const rows = Array.isArray(data?.list) ? data.list : data ? [data] : [];
    const item = rows[0];
    if (!item) {
      return {
        apiUrl,
        ok: false,
        status: response.status,
        elapsedMs: Date.now() - started,
        error: "API returned no item",
      };
    }

    return {
      apiUrl,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      item: {
        id: item.id ?? null,
        name: item.name ?? "",
        slug: item.slug ?? "",
        movieCode: item.movie_code ?? item.slug ?? "",
        typeName: item.type_name ?? "",
        year: item.year ?? "",
        quality: item.quality ?? "",
        duration: item.time ?? "",
        posterUrl: item.poster_url ?? "",
        thumbUrl: item.thumb_url ?? "",
        playerUrl: getPlayerUrl(item),
      },
    };
  } catch (error) {
    return {
      apiUrl,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : "API request failed",
    };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = String(body?.pageUrl || "").trim();

    if (!allowedAvdbUrl(pageUrl)) {
      return NextResponse.json({ ok: false, error: "อนุญาตเฉพาะ URL บน avdbapi.com" }, { status: 400 });
    }

    const started = Date.now();
    const pageResponse = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const html = await pageResponse.text();

    if (!pageResponse.ok) {
      return NextResponse.json({
        ok: false,
        error: `AVDB page returned HTTP ${pageResponse.status}`,
        pageUrl,
        status: pageResponse.status,
      });
    }

    const apiLinks = extractApiLinks(html, pageUrl).slice(0, 60);
    const apiResults = await mapConcurrent(apiLinks, 6, loadApi);
    const items = apiResults
      .filter((result: any) => result?.item)
      .map((result: any, index) => ({
        row: index + 1,
        apiUrl: result.apiUrl,
        apiStatus: result.status,
        apiElapsedMs: result.elapsedMs,
        ...result.item,
      }));

    return NextResponse.json({
      ok: true,
      pageUrl,
      finalPageUrl: pageResponse.url,
      pageStatus: pageResponse.status,
      apiLinksFound: apiLinks.length,
      itemsFound: items.length,
      elapsedMs: Date.now() - started,
      items,
      apiErrors: apiResults.filter((result: any) => !result?.item),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 },
    );
  }
}
