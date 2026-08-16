import chromium from "@sparticuz/chromium";
import puppeteer, { type HTTPResponse, type Page } from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export type AvdbScanItem = {
  row: number;
  apiUrl: string;
  apiStatus: number;
  apiElapsedMs: number;
  id: string | number | null;
  name: string;
  originalName: string;
  slug: string;
  movieCode: string;
  typeName: string;
  year: string;
  quality: string;
  duration: string;
  description: string;
  posterUrl: string;
  thumbUrl: string;
  playerUrl: string | null;
  playerProvider: string | null;
  rawData: Record<string, unknown>;
};

export type AvdbScanResult = {
  ok: boolean;
  responseStatus: number;
  error?: string;
  mode: "chromium";
  pageUrl: string;
  finalPageUrl?: string;
  pageStatus?: number;
  title?: string;
  apiLinksFound?: number;
  itemsFound?: number;
  elapsedMs?: number;
  items?: AvdbScanItem[];
  apiErrors?: Array<Record<string, unknown>>;
};

export function allowedAvdbUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "avdbapi.com" || host === "www.avdbapi.com");
  } catch {
    return false;
  }
}

export function buildAvdbPageUrl(pageNumber: number) {
  const page = Math.max(1, Math.min(10262, Math.trunc(pageNumber || 1)));
  return page <= 1 ? "https://avdbapi.com/" : `https://avdbapi.com/index-${page}/`;
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

async function extractDomApiLinks(page: Page, pageUrl: string) {
  return page.evaluate((baseUrl: string) => {
    const found = new Set<string>();
    const urlPattern = /https?:\/\/[^\s"'<>]+|(?:^|["'`])\/?[^\s"'<>]+/gi;

    function add(value: string | null) {
      if (!value) return;
      for (const candidate of value.match(urlPattern) || [value]) {
        try {
          const absolute = new URL(candidate.replace(/^["'`]/, ""), baseUrl);
          const host = absolute.hostname.toLowerCase();
          const looksApi =
            /\bapi\b/i.test(value) ||
            /[?&](?:api|key|token)=/i.test(absolute.search) ||
            /\/api(?:[/?._-]|$)/i.test(absolute.pathname);
          if (
            looksApi &&
            absolute.protocol === "https:" &&
            (host === "avdbapi.com" || host === "www.avdbapi.com")
          ) {
            found.add(absolute.toString());
          }
        } catch {
          // Ignore malformed DOM attributes.
        }
      }
    }

    for (const element of document.querySelectorAll("a,button,[data-api-url],[data-url],[data-href]")) {
      const attributes = Array.from(element.attributes)
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .join(" ");
      const text = element.textContent || "";
      const source = `${text} ${attributes}`;

      for (const attribute of Array.from(element.attributes)) {
        if (
          /url|href|link|onclick|api|data/i.test(attribute.name) ||
          /\bapi\b/i.test(source) ||
          /\/api(?:[/?._-]|$)/i.test(source)
        ) {
          add(attribute.value);
        }
      }
    }

    return [...found];
  }, pageUrl);
}

async function navigateAvdbPage(page: Page, targetUrl: string): Promise<HTTPResponse | null> {
  const target = new URL(targetUrl);
  if (target.pathname === "/" || target.pathname === "") {
    return page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  }

  // AVDB currently exposes numbered pagination links on the index page. Warm
  // the same browser context on the homepage first, then follow the normal
  // pagination anchor so cookies/referrer/navigation state match a user click.
  const home = await page.goto("https://avdbapi.com/", { waitUntil: "domcontentloaded", timeout: 25000 });
  if ((home?.status() ?? 0) >= 400) return home;
  await new Promise((resolve) => setTimeout(resolve, 900));

  const targetPath = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
  const href = await page.evaluate((pathname: string) => {
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      try {
        const url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
        const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
        if (path === pathname) return url.toString();
      } catch {
        // Ignore malformed pagination links.
      }
    }
    return "";
  }, targetPath);

  if (!href || !allowedAvdbUrl(href)) {
    return page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  }

  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 });
  const clicked = await page.evaluate((absoluteHref: string) => {
    const anchor = Array.from(document.querySelectorAll("a[href]")).find((element) => {
      try {
        return new URL((element as HTMLAnchorElement).href, window.location.href).toString() === absoluteHref;
      } catch {
        return false;
      }
    }) as HTMLAnchorElement | undefined;
    if (!anchor) return false;
    anchor.click();
    return true;
  }, href);

  if (!clicked) return page.goto(href, { waitUntil: "domcontentloaded", timeout: 25000 });
  return navigation;
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

  const playerUrl = getPlayerUrl(item);
  return {
    apiUrl,
    ok: status >= 200 && status < 300,
    status,
    elapsedMs,
    item: {
      id: item.id ?? null,
      name: String(item.name ?? ""),
      originalName: String(item.original_name ?? item.original_title ?? ""),
      slug: String(item.slug ?? ""),
      movieCode: String(item.movie_code ?? item.slug ?? ""),
      typeName: String(item.type_name ?? ""),
      year: String(item.year ?? ""),
      quality: String(item.quality ?? ""),
      duration: String(item.time ?? item.duration ?? ""),
      description: String(item.description ?? item.content ?? ""),
      posterUrl: String(item.poster_url ?? ""),
      thumbUrl: String(item.thumb_url ?? ""),
      playerUrl,
      playerProvider: providerFromUrl(playerUrl),
      rawData: item && typeof item === "object" ? (item as Record<string, unknown>) : {},
    },
  };
}

export async function scanAvdbPage(pageUrl: string, options: { apiConcurrency?: number } = {}): Promise<AvdbScanResult> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  if (!allowedAvdbUrl(pageUrl)) {
    return {
      ok: false,
      responseStatus: 400,
      error: "อนุญาตเฉพาะ URL บน avdbapi.com",
      mode: "chromium",
      pageUrl,
    };
  }

  const started = Date.now();
  try {
    chromium.setGraphicsMode = false;
    const executablePath = await getServerlessChromiumExecutable();
    const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });

    browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
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

    const nav = await navigateAvdbPage(page, pageUrl);
    const pageStatus = nav?.status() ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const finalPageUrl = page.url();
    const title = await page.title().catch(() => "");
    const html = await page.content();

    if (pageStatus >= 400) {
      return {
        ok: false,
        responseStatus: 502,
        error: `AVDB browser page returned HTTP ${pageStatus}`,
        pageUrl,
        finalPageUrl,
        pageStatus,
        title,
        mode: "chromium",
        elapsedMs: Date.now() - started,
      };
    }

    const pageText = stripTags(html).toLowerCase();
    if (/site unavailable|unable to access this site|service unavailable/.test(pageText)) {
      return {
        ok: false,
        responseStatus: 502,
        error: "AVDB ต้นทางตอบหน้า Site Unavailable ไม่สามารถอ่านข้อมูลได้ในขณะนี้",
        pageUrl,
        finalPageUrl,
        pageStatus,
        title,
        mode: "chromium",
        elapsedMs: Date.now() - started,
      };
    }

    const domApiLinks = await extractDomApiLinks(page, finalPageUrl).catch(() => [] as string[]);
    const apiLinks = [...new Set([...domApiLinks, ...extractApiLinks(html, finalPageUrl)])]
      .filter((url) => allowedAvdbUrl(url))
      .slice(0, 60);

    if (!apiLinks.length) {
      return {
        ok: false,
        responseStatus: 422,
        error: "ไม่พบลิงก์ API ในหน้านี้ ตรวจสอบว่าเป็นหน้า AVDB index ที่ถูกต้องหรือไม่",
        pageUrl,
        finalPageUrl,
        pageStatus,
        title,
        mode: "chromium",
        apiLinksFound: 0,
        itemsFound: 0,
        elapsedMs: Date.now() - started,
      };
    }

    const requestedConcurrency = Number.isFinite(options.apiConcurrency)
      ? Math.max(1, Math.min(6, Math.trunc(options.apiConcurrency || 1)))
      : 6;

    const rawApiResults = await page.evaluate(
      async ({ urls, workerCount }) => {
        const results: Array<{
          index: number;
          apiUrl: string;
          status: number;
          elapsedMs: number;
          text: string;
          error?: string;
        }> = [];

        let cursor = 0;
        async function worker() {
          while (cursor < urls.length) {
            const index = cursor++;
            const apiUrl = urls[index];
            const startedAt = performance.now();
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 12000);

            try {
              const response = await fetch(apiUrl, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json,text/plain,*/*" },
                signal: controller.signal,
              });
              const text = await response.text();
              results.push({
                index,
                apiUrl,
                status: response.status,
                elapsedMs: Math.round(performance.now() - startedAt),
                text,
              });
            } catch (error) {
              results.push({
                index,
                apiUrl,
                status: 0,
                elapsedMs: Math.round(performance.now() - startedAt),
                text: "",
                error: error instanceof Error ? error.message : "Browser fetch failed",
              });
            } finally {
              window.clearTimeout(timeout);
            }
          }
        }

        await Promise.all(Array.from({ length: Math.min(workerCount, urls.length) }, worker));
        return results.sort((left, right) => left.index - right.index);
      },
      { urls: apiLinks, workerCount: requestedConcurrency },
    );

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

    const items: AvdbScanItem[] = apiResults
      .filter((result: any) => result?.item)
      .map((result: any, index) => ({
        row: index + 1,
        apiUrl: result.apiUrl,
        apiStatus: result.status,
        apiElapsedMs: result.elapsedMs,
        ...result.item,
      }));

    return {
      ok: true,
      responseStatus: 200,
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
    };
  } catch (error) {
    return {
      ok: false,
      responseStatus: 500,
      error: error instanceof Error ? error.message : "AVDB browser scan failed",
      mode: "chromium",
      pageUrl,
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
