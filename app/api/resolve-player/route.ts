import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/{2,}/g, "/");
}

function allowedPlayerUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const path = normalizePath(url.pathname);
    return (
      url.protocol === "https:" &&
      (host === "upload18.org" || host === "www.upload18.org") &&
      /^\/play\/index\//i.test(path)
    );
  } catch {
    return false;
  }
}

function classifyManifest(raw: string) {
  try {
    const url = new URL(raw);
    const path = normalizePath(url.pathname);
    if (url.hostname === "helvid.com" && path.startsWith("/m/")) return "helvid-manifest";
    if (url.hostname === "helvid.com" && path.startsWith("/p/")) return "helvid-playlist";
    if (/\.m3u8$/i.test(path)) return "m3u8";
    if (path === "/play/token_hash") return "token-hash";
  } catch {
    // Ignore malformed network URLs.
  }
  return null;
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = await request.json();
    const playerUrl = String(body?.playerUrl || "").trim();

    if (!allowedPlayerUrl(playerUrl)) {
      return NextResponse.json(
        { ok: false, error: "รองรับเฉพาะ https://upload18.org/play/index/..." },
        { status: 400 },
      );
    }

    const started = Date.now();
    chromium.setGraphicsMode = false;
    const executablePath = await getServerlessChromiumExecutable();
    const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });

    browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
      headless: "shell",
      defaultViewport: { width: 1365, height: 768, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
    });
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(8000);

    const seen = new Map<
      string,
      {
        url: string;
        kind: string;
        resourceType: string;
        status: number | null;
        contentType: string | null;
        atMs: number;
      }
    >();

    page.on("request", (req) => {
      const kind = classifyManifest(req.url());
      if (!kind || seen.has(req.url())) return;
      seen.set(req.url(), {
        url: req.url(),
        kind,
        resourceType: req.resourceType(),
        status: null,
        contentType: null,
        atMs: Date.now() - started,
      });
    });

    page.on("response", (response) => {
      const kind = classifyManifest(response.url());
      if (!kind) return;
      const existing = seen.get(response.url());
      const headers = response.headers();
      seen.set(response.url(), {
        url: response.url(),
        kind,
        resourceType: existing?.resourceType || "other",
        status: response.status(),
        contentType: headers["content-type"] || null,
        atMs: existing?.atMs ?? Date.now() - started,
      });
    });

    let navigationStatus = 0;
    let navigationError: string | null = null;

    try {
      const nav = await page.goto(playerUrl, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      navigationStatus = nav?.status() ?? 0;
    } catch (error) {
      navigationError = error instanceof Error ? error.message : "Navigation failed";
    }

    const hasPreferredManifest = () =>
      [...seen.values()].some((item) => item.kind === "helvid-manifest");

    for (let i = 0; i < 8 && !hasPreferredManifest(); i += 1) {
      await sleep(500);
    }

    let playAttempted = false;
    if (!hasPreferredManifest()) {
      try {
        playAttempted = await page.evaluate(() => {
          const selectors = [
            ".jw-display-icon-container",
            ".jw-icon-playback",
            "button[aria-label='Play']",
            "button[aria-label*='play' i]",
            "[role='button'][aria-label*='play' i]",
            "video",
          ];

          for (const selector of selectors) {
            const element = document.querySelector(selector) as HTMLElement | null;
            if (!element) continue;
            element.click();
            return true;
          }
          return false;
        });
      } catch {
        playAttempted = false;
      }

      for (let i = 0; i < 12 && !hasPreferredManifest(); i += 1) {
        await sleep(500);
      }
    }

    const finalPageUrl = page.url();
    const title = await page.title().catch(() => "");
    const candidates = [...seen.values()];
    const preferred =
      candidates.find((item) => item.kind === "helvid-manifest") ||
      candidates.find((item) => item.kind === "helvid-playlist") ||
      candidates.find((item) => item.kind === "m3u8") ||
      null;

    return NextResponse.json({
      ok: Boolean(preferred),
      playerUrl,
      finalPageUrl,
      title,
      navigationStatus,
      navigationError,
      redirectedToLogin: /\/login(?:[/?#]|$)/i.test(finalPageUrl),
      playAttempted,
      elapsedMs: Date.now() - started,
      manifestUrl: preferred?.url ?? null,
      manifestKind: preferred?.kind ?? null,
      manifestStatus: preferred?.status ?? null,
      manifestContentType: preferred?.contentType ?? null,
      candidates: candidates.slice(0, 12),
      error: preferred
        ? null
        : "เปิด Player แล้ว แต่ยังไม่พบ Manifest ใน Network ของ browser session",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Player resolve failed",
      },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
