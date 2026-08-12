import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";
import { isHlshubConfigured, saveHlshubResult, type HlshubPageMetadata } from "@/lib/hlshub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SOURCE_HOSTS = ["missav123.com", "missav.com"];
const DEFAULT_MEDIA_HOSTS = ["surrit.com", "fourhoi.com", "helvid.com"];
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

function hostMatches(hostname: string, hosts: string[]) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function allowedPageUrl(raw: string) {
  const url = new URL(raw);
  const hosts = (process.env.ALLOWED_SOURCE_PAGE_HOSTS || DEFAULT_SOURCE_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (url.protocol !== "https:" || !hostMatches(url.hostname.toLowerCase(), hosts)) {
    throw new Error("URL ไม่อยู่ใน source page allowlist");
  }
  return url;
}

function isManifestUrl(raw: string) {
  try {
    const url = new URL(raw);
    const hosts = [
      ...DEFAULT_MEDIA_HOSTS,
      ...(process.env.ALLOWED_HLS_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()),
    ].filter(Boolean);
    return (
      url.protocol === "https:" &&
      hostMatches(url.hostname.toLowerCase(), [...new Set(hosts)]) &&
      (/\.m3u8(?:$|\?)/i.test(url.pathname + url.search) || /\/playlist(?:\/|\.|$)/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

async function testOne(browser: Awaited<ReturnType<typeof puppeteer.launch>>, rawUrl: string) {
  const started = Date.now();
  let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;

  try {
    const pageUrl = allowedPageUrl(rawUrl);
    page = await browser.newPage();
    await page.setUserAgent(DEFAULT_UA);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    page.setDefaultNavigationTimeout(20000);

    const captured = new Map<string, { url: string; status: number; contentType: string }>();
    page.on("response", (response) => {
      const url = response.url();
      if (!isManifestUrl(url)) return;
      captured.set(url, {
        url,
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
      });
    });

    const navigation = await page.goto(pageUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const pageMetadata = await page.evaluate(() => {
      const meta = (name: string, property = name) =>
        document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${property}"]`)?.content?.trim() || null;
      const text = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
      const bodyText = text(document.body?.innerText).slice(0, 12000);
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const slug = pathParts[pathParts.length - 1] || "";
      const locale = pathParts.find((part) => /^(?:th|en|ja|ko|cn|ms|de|fr|vi|id|fil|pt)$/i.test(part))?.toLowerCase() || null;
      const fields: Record<string, string> = {};

      for (const node of Array.from(document.querySelectorAll<HTMLElement>(".text-secondary"))) {
        const value = text(node.innerText);
        const separator = value.search(/[:：]/);
        if (separator > 0) fields[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
      }

      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"), (anchor) => ({
        href: anchor.href,
        text: text(anchor.textContent),
      })).filter((link) => link.text || /(?:actresses|actors|directors|genres|makers|labels)/i.test(link.href)).slice(0, 250);
      const people = links.filter((link) => /\/(?:actresses|actors|directors)\//i.test(link.href)).map((link) => ({
        name: link.text,
        profileUrl: link.href,
        role: (/\/actresses\//i.test(link.href) ? "actress" : /\/actors\//i.test(link.href) ? "actor" : "director") as "actress" | "actor" | "director",
      })).filter((person) => person.name);
      const terms = links.filter((link) => /\/(?:genres|makers|labels)\//i.test(link.href)).map((link) => ({
        name: link.text,
        url: link.href,
        type: (/\/makers\//i.test(link.href) ? "maker" : /\/labels\//i.test(link.href) ? "label" : "genre") as "maker" | "label" | "genre",
      })).filter((term) => term.name);
      const imageUrls = Array.from(new Set([
        meta("og:image", "og:image"),
        meta("twitter:image", "twitter:image"),
        document.querySelector<HTMLVideoElement>("video[data-poster]")?.dataset.poster || null,
        ...Array.from(document.querySelectorAll<HTMLImageElement>("img[src]"), (image) => image.src),
      ].filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)))).slice(0, 30);
      const releaseDate = meta("og:video:release_date", "og:video:release_date") || bodyText.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || null;
      const durationValue = meta("og:video:duration", "og:video:duration");
      const durationSeconds = durationValue ? Number(durationValue) || null : null;
      const title = meta("og:title", "og:title") || text(document.querySelector("h1")?.textContent) || document.title || null;
      const synopsis = meta("description") || meta("og:description", "og:description");
      const code = fields["รหัส"] || fields["Code"] || fields["コード"] || slug || null;

      return {
        canonicalUrl: window.location.href.split("#")[0],
        locale,
        slug,
        code,
        title,
        originalTitle: fields["ชื่อ"] || fields["Original title"] || null,
        synopsis,
        releaseDate,
        durationSeconds,
        isSeries: /series|ซีรีส์|episode|ตอนที่/i.test(bodyText),
        imageUrls,
        people,
        terms,
        raw: {
          documentTitle: document.title,
          meta: Array.from(document.querySelectorAll<HTMLMetaElement>("meta")).slice(0, 100).map((item) => ({ name: item.name, property: item.getAttribute("property"), content: item.content })),
          fields,
          links,
          bodyText,
        },
      } satisfies HlshubPageMetadata;
    }).catch(() => null);
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (video) void video.play().catch(() => undefined);
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const passed = [...captured.values()].find((item) => item.status >= 200 && item.status < 400) || null;
    return {
      url: pageUrl.toString(),
      ok: Boolean(passed),
      status: passed?.status || navigation?.status() || 0,
      sourceStatus: navigation?.status() ?? 0,
      mediaUrl: passed?.url || null,
      contentType: passed?.contentType || null,
      elapsedMs: Date.now() - started,
      error: passed ? undefined : "ไม่พบ manifest ที่ตอบสำเร็จจาก network ของ Chromium",
      pageMetadata,
    };
  } catch (error) {
    return {
      url: rawUrl,
      ok: false,
      status: 0,
      sourceStatus: 0,
      mediaUrl: null,
      contentType: null,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Bulk test failed",
      pageMetadata: undefined,
    };
  } finally {
    await page?.close().catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = await request.json();
    const urls = Array.isArray(body?.urls) ? body.urls.map((value: unknown) => String(value)).filter(Boolean).slice(0, 12) : [];
    if (!urls.length) return NextResponse.json({ ok: false, error: "ไม่พบ URL สำหรับทดสอบ" }, { status: 400 });

    chromium.setGraphicsMode = false;
    const executablePath = await getServerlessChromiumExecutable();
    const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
    browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
      headless: "shell",
      defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    });

    const results: Array<Awaited<ReturnType<typeof testOne>>> = [];
    let cursor = 0;
    async function worker() {
      while (cursor < urls.length) {
        const index = cursor++;
        results[index] = await testOne(browser!, urls[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, () => worker()));

    const storage = {
      configured: isHlshubConfigured(),
      savedCount: 0,
      failedCount: 0,
      errors: [] as string[],
    };
    if (storage.configured) {
      for (const result of results) {
        try {
          const saved = await saveHlshubResult(result);
          if (saved.saved) storage.savedCount += 1;
          else {
            storage.failedCount += 1;
            if (saved.reason) storage.errors.push(saved.reason);
          }
        } catch (error) {
          storage.failedCount += 1;
          storage.errors.push(error instanceof Error ? error.message : "บันทึก hlshub ไม่สำเร็จ");
        }
      }
    }

    return NextResponse.json({
      ok: true,
      results: results.map(({ pageMetadata: _pageMetadata, ...result }) => result),
      storage: {
        ...storage,
        errors: [...new Set(storage.errors)].slice(0, 3),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bulk test failed" },
      { status: 400 },
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
