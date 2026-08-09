import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

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
    const looksApi =
      text === "api" ||
      text.startsWith("api ") ||
      /\bapi\b/.test(attrs) ||
      /\/api(?:[/?._-]|$)/i.test(href) ||
      /[?&](?:api|key|token)=/i.test(href);

    if (!looksApi) continue;

    try {
      const absolute = new URL(href, pageUrl).toString();
      if (allowedAvdbUrl(absolute)) found.add(absolute);
    } catch {
      // Ignore malformed links.
    }
  }

  if (!found.size) {
    const rawUrl = /(?:https?:\/\/(?:www\.)?avdbapi\.com)?\/[A-Za-z0-9_./?=&%-]*api[A-Za-z0-9_./?=&%-]*/gi;
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

function normalizeApiPayload(apiUrl: string, status: number, elapsedMs: number, text: string) {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      apiUrl,
      ok: false,
      status,
      elapsedMs,
      error: "API response is not JSON",
      preview: text.slice(0, 240),
    };
  }

  const rows = Array.isArray(data?.list) ? data.list : data ? [data] : [];
  const item = rows[0];

  if (!item) {
    return {
      apiUrl,
      ok: false,
      status,
      elapsedMs,
      error: "API returned no item",
    };
  }

  return {
    apiUrl,
    ok: status >= 200 && status < 300,
    status,
    elapsedMs,
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
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = await request.json();
    const pageUrl = String(body?.pageUrl || "").trim();

    if (!allowedAvdbUrl(pageUrl)) {
      return NextResponse.json(
        { ok: false, error: "อนุญาตเฉพาะ URL บน avdbapi.com" },
        { status: 400 },
      );
    }

    const started = Date.now();
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(10000);

    const nav = await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    const pageStatus = nav?.status() ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const finalPageUrl = page.url();
    const title = await page.title().catch(() => "");
    const html = await page.content();

    if (pageStatus >= 400) {
      return NextResponse.json({
        ok: false,
        error: `AVDB browser page returned HTTP ${pageStatus}`,
        pageUrl,
        finalPageUrl,
        pageStatus,
        title,
        mode: "chromium",
      });
    }

    const apiLinks = extractApiLinks(html, finalPageUrl).slice(0, 60);

    const rawApiResults = await page.evaluate(async (urls) => {
      const results: Array<{
        apiUrl: string;
        status: number;
        elapsedMs: number;
        text: string;
        error?: string;
      }> = [];

      for (const apiUrl of urls) {
        const startedAt = performance.now();
        try {
          const response = await fetch(apiUrl, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json,text/plain,*/*" },
          });
          const text = await response.text();
          results.push({
            apiUrl,
            status: response.status,
            elapsedMs: Math.round(performance.now() - startedAt),
            text,
          });
        } catch (error) {
          results.push({
            apiUrl,
            status: 0,
            elapsedMs: Math.round(performance.now() - startedAt),
            text: "",
            error: error instanceof Error ? error.message : "Browser fetch failed",
          });
        }
      }

      return results;
    }, apiLinks);

    const apiResults = rawApiResults.map((result) =>
      result.error
        ? {
            apiUrl: result.apiUrl,
            ok: false,
            status: result.status,
            elapsedMs: result.elapsedMs,
            error: result.error,
          }
        : normalizeApiPayload(result.apiUrl, result.status, result.elapsedMs, result.text),
    );

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
      mode: "chromium",
      pageUrl,
      finalPageUrl,
      pageStatus,
      title,
      apiLinksFound: apiLinks.length,
      itemsFound: items.length,
      elapsedMs: Date.now() - started,
      items,
      apiErrors: apiResults.filter((result: any) => !result?.item),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Chromium AVDB scan failed",
      },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
