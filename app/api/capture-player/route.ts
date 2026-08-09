import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function allowedPlayerUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "upload18.org" || host === "www.upload18.org") &&
      url.pathname.startsWith("/play/")
    );
  } catch {
    return false;
  }
}

function classify(url: string) {
  try {
    const path = new URL(url).pathname;
    if (path === "/play/token_hash" || path.startsWith("/m/") || path.startsWith("/p/") || /\.m3u8$/i.test(path)) {
      return "manifest";
    }
    if (path.startsWith("/s/")) return "segment";
    if (path.startsWith("/d/")) return "direct";
  } catch {
    // Ignore malformed URLs.
  }
  return "other";
}

function pickHeaders(headers: Record<string, string>) {
  const names = [
    "content-type",
    "content-length",
    "access-control-allow-origin",
    "x-request-id",
    "x-u18-cache",
    "x-u18-guard",
    "x-u18-session-reissue",
  ];
  return Object.fromEntries(names.map((name) => [name, headers[name] ?? null]));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = await request.json();
    const playerUrl = String(body?.playerUrl || "").trim();

    if (!allowedPlayerUrl(playerUrl)) {
      return NextResponse.json(
        { ok: false, error: "อนุญาตเฉพาะ https://upload18.org/play/..." },
        { status: 400 },
      );
    }

    const started = Date.now();
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: { width: 1365, height: 768, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    page.setDefaultNavigationTimeout(22000);
    page.setDefaultTimeout(8000);

    const requests: Array<{
      type: string;
      url: string;
      method: string;
      resourceType: string;
      atMs: number;
    }> = [];
    const responses: Array<{
      type: string;
      url: string;
      status: number;
      headers: Record<string, string | null>;
      atMs: number;
    }> = [];

    page.on("request", (req) => {
      const type = classify(req.url());
      if (type === "other") return;
      requests.push({
        type,
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        atMs: Date.now() - started,
      });
    });

    page.on("response", async (response) => {
      const type = classify(response.url());
      if (type === "other") return;
      responses.push({
        type,
        url: response.url(),
        status: response.status(),
        headers: pickHeaders(response.headers()),
        atMs: Date.now() - started,
      });
    });

    let navigationStatus = 0;
    let navigationError = "";
    try {
      const nav = await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 22000 });
      navigationStatus = nav?.status() ?? 0;
    } catch (error) {
      navigationError = error instanceof Error ? error.message : "Navigation failed";
    }

    await sleep(3500);

    let playAttempted = false;
    if (!requests.some((entry) => entry.type === "manifest")) {
      try {
        playAttempted = await page.evaluate(() => {
          const selectors = [
            ".jw-display-icon-container",
            ".jw-icon-playback",
            "button[aria-label='Play']",
            "button[aria-label*='play' i]",
            "video",
          ];
          for (const selector of selectors) {
            const element = document.querySelector(selector) as HTMLElement | null;
            if (element) {
              element.click();
              return true;
            }
          }
          return false;
        });
      } catch {
        playAttempted = false;
      }
      await sleep(6500);
    }

    const currentUrl = page.url();
    const title = await page.title().catch(() => "");
    const manifests = requests.filter((entry) => entry.type === "manifest");
    const manifestResponses = responses.filter((entry) => entry.type === "manifest");
    const segmentRequests = requests.filter((entry) => entry.type === "segment");

    return NextResponse.json({
      ok: manifests.length > 0,
      playerUrl,
      navigationStatus,
      navigationError: navigationError || null,
      finalPageUrl: currentUrl,
      title,
      redirectedToLogin: /\/login(?:[/?#]|$)/i.test(currentUrl),
      playAttempted,
      elapsedMs: Date.now() - started,
      manifestCount: manifests.length,
      manifestUrl: manifests[0]?.url ?? null,
      manifests: manifests.slice(0, 8),
      manifestResponses: manifestResponses.slice(0, 8),
      segmentCount: segmentRequests.length,
      segmentSamples: segmentRequests.slice(0, 5),
      note: manifests.length
        ? "จับ manifest จาก Browser Network ได้แล้ว"
        : "ยังไม่พบ manifest; ตรวจ finalPageUrl และ redirectedToLogin",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Browser capture failed" },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
