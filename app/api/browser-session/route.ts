import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Page } from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";
import { createStreamToken } from "@/lib/stream-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SOURCE_PAGE_HOSTS = ["missav123.com", "missav.com", "fourhoi.com", "upload18.org"];
const DEFAULT_MEDIA_HOSTS = ["surrit.com", "fourhoi.com", "helvid.com"];
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

type BrowserSessionState = {
  browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  page: Page;
  mediaUrl: string;
  finalPageUrl: string;
  proxyUrl: string | null;
  expiresAt: number;
};

// The browser page and its cookie jar must remain alive while HLS.js requests
// the manifest and segments. A short-lived in-memory session is appropriate
// for this diagnostic tool and avoids forwarding Cloudflare cookies to the UI.
const sessions = new Map<string, BrowserSessionState>();
const sessionByPageUrl = new Map<string, string>();
type BrowserInstance = Awaited<ReturnType<typeof puppeteer.launch>>;
let sharedBrowser: BrowserInstance | null = null;
let sharedBrowserPromise: Promise<BrowserInstance> | null = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  if (sharedBrowserPromise) return sharedBrowserPromise;

  sharedBrowserPromise = (async () => {
    chromium.setGraphicsMode = false;
    const executablePath = await getServerlessChromiumExecutable();
    const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
    const browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
      headless: "shell",
      defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    });
    sharedBrowser = browser;
    return browser;
  })();

  try {
    return await sharedBrowserPromise;
  } finally {
    sharedBrowserPromise = null;
  }
}

function hostMatches(hostname: string, hosts: string[]) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isAllowedSourcePage(raw: string) {
  try {
    const url = new URL(raw);
    const hosts = (process.env.ALLOWED_SOURCE_PAGE_HOSTS || DEFAULT_SOURCE_PAGE_HOSTS.join(","))
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return url.protocol === "https:" && hostMatches(url.hostname.toLowerCase(), hosts);
  } catch {
    return false;
  }
}

function allowedMediaHosts() {
  return [
    ...DEFAULT_MEDIA_HOSTS,
    ...(process.env.ALLOWED_HLS_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()),
  ].filter(Boolean);
}

function isAllowedMediaUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hostMatches(url.hostname.toLowerCase(), [...new Set(allowedMediaHosts())]);
  } catch {
    return false;
  }
}

function isManifestUrl(raw: string) {
  return (
    isAllowedMediaUrl(raw) &&
    (/\.m3u8(?:$|\?)/i.test(raw) || /\/playlist(?:\/|\.|$)/i.test(new URL(raw).pathname))
  );
}

function browserProxyUrl(origin: string, sessionId: string, target: string) {
  const url = new URL("/api/browser-session", origin);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("url", target);
  return `${url.pathname}${url.search}`;
}

function rewriteBrowserManifest(text: string, base: URL, origin: string, sessionId: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (!trimmed.startsWith("#")) {
        try {
          return browserProxyUrl(origin, sessionId, new URL(trimmed, base).toString());
        } catch {
          return line;
        }
      }

      if (trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
          try {
            return `URI="${browserProxyUrl(origin, sessionId, new URL(value, base).toString())}"`;
          } catch {
            return `URI="${value}"`;
          }
        });
      }

      return line;
    })
    .join("\n");
}

async function waitForMedia(page: Page, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const mediaUrls = await page.evaluate(() => {
      const values = new Set<string>();
      for (const element of Array.from(document.querySelectorAll("video, source"))) {
        for (const attribute of ["src", "data-src"]) {
          const value = element.getAttribute(attribute);
          if (value) values.add(value);
        }
      }
      return [...values];
    }).catch(() => [] as string[]);

    if (mediaUrls.some(isManifestUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      if (sessionByPageUrl.get(session.finalPageUrl) === id) sessionByPageUrl.delete(session.finalPageUrl);
      await session.page.close().catch(() => undefined);
    }
  }
}

function sessionPayload(id: string, session: BrowserSessionState) {
  return {
    sessionId: id,
    mediaUrl: session.mediaUrl,
    proxyUrl: session.proxyUrl,
    userAgent: DEFAULT_UA,
    referer: session.finalPageUrl,
    origin: new URL(session.finalPageUrl).origin,
    expiresAt: session.expiresAt,
  };
}

export async function POST(request: NextRequest) {
  let page: Page | null = null;
  let storedSession = false;

  try {
    await cleanupExpiredSessions();
    const body = await request.json();
    const pageUrl = String(body?.pageUrl || "").trim();
    const userAgent = String(body?.userAgent || DEFAULT_UA);
    const mediaHint = String(body?.mediaUrl || "").trim();
    const forceFresh = body?.forceFresh === true;

    if (!isAllowedSourcePage(pageUrl)) {
      return NextResponse.json(
        { ok: false, error: "URL หน้าเว็บไม่อยู่ใน source page allowlist" },
        { status: 400 },
      );
    }

    const cachedId = sessionByPageUrl.get(pageUrl);
    const cached = cachedId ? sessions.get(cachedId) : undefined;
    if (!forceFresh && cached && cached.expiresAt > Date.now() && !cached.page.isClosed()) {
      cached.expiresAt = Date.now() + 10 * 60 * 1000;
      return NextResponse.json({ ok: true, session: sessionPayload(cachedId!, cached) });
    }
    if (forceFresh && cached) {
      sessions.delete(cachedId!);
      if (sessionByPageUrl.get(pageUrl) === cachedId) sessionByPageUrl.delete(pageUrl);
      await cached.page.close().catch(() => undefined);
    }

    const browser = await getBrowser();

    page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(10000);

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

    const navigation = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise((resolve) => setTimeout(resolve, mediaHint && isManifestUrl(mediaHint) ? 650 : 900));
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      if (video) void video.play().catch(() => undefined);
    }).catch(() => undefined);
    const hintIsValid = mediaHint && isManifestUrl(mediaHint);
    if (!hintIsValid) await waitForMedia(page, 4500);

    const finalPageUrl = page.url();
    const media = [...captured.values()].filter((item) => item.status < 400);
    const manifest = media[0] || (hintIsValid ? { url: mediaHint, status: 200, contentType: "application/vnd.apple.mpegurl" } : null);
    if (!manifest) {
      return NextResponse.json(
        {
          ok: false,
          error: "Chromium เปิดหน้าเว็บแล้ว แต่ยังไม่พบ HLS manifest ที่ตอบสำเร็จ",
          pageStatus: navigation?.status() ?? 0,
          finalPageUrl,
          captured: [...captured.values()].slice(0, 10),
        },
        { status: 502 },
      );
    }

    const cookie = await page.cookies(manifest.url).then((items) => items.map((item) => `${item.name}=${item.value}`).join("; ")).catch(() => "");
    const sessionId = randomUUID();
    const finalSessionUrl = finalPageUrl;
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const proxyUrl = (() => {
      try {
        const token = createStreamToken({
          url: manifest.url,
          origin: new URL(finalPageUrl).origin,
          referer: finalPageUrl,
          userAgent,
          cookie,
          expiresAt: Date.now() + 8 * 60 * 1000,
        });
        return `/api/stream?token=${encodeURIComponent(token)}`;
      } catch {
        return null;
      }
    })();
    sessions.set(sessionId, {
      browser,
      page: page!,
      mediaUrl: manifest.url,
      finalPageUrl: finalSessionUrl,
      proxyUrl,
      expiresAt,
    });
    sessionByPageUrl.set(pageUrl, sessionId);
    storedSession = true;

    return NextResponse.json({
      ok: true,
      sessionId,
      session: {
        ...sessionPayload(sessionId, sessions.get(sessionId)!),
      },
      pageStatus: navigation?.status() ?? 0,
      finalPageUrl,
      captured: media.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Browser session failed" },
      { status: 502 },
    );
  } finally {
    if (!storedSession) await page?.close().catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  await cleanupExpiredSessions();
  const sessionId = request.nextUrl.searchParams.get("session") || "";
  const raw = request.nextUrl.searchParams.get("url") || "";
  const session = sessions.get(sessionId);

  if (!session) {
    return NextResponse.json({ ok: false, error: "Browser session หมดอายุหรือไม่พบ session" }, { status: 410 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Media URL ไม่ถูกต้อง" }, { status: 400 });
  }

  if (!isAllowedMediaUrl(target.toString())) {
    return NextResponse.json({ ok: false, error: "Media host ไม่อยู่ใน allowlist" }, { status: 403 });
  }

  try {
    const payload = await session.page.evaluate(async (targetUrl) => {
      const response = await fetch(targetUrl, { credentials: "include", cache: "no-store" });
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const isManifest = /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(targetUrl);

      if (isManifest) {
        return {
          kind: "manifest" as const,
          status: response.status,
          statusText: response.statusText,
          contentType,
          body: await response.text(),
        };
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }

      return {
        kind: "binary" as const,
        status: response.status,
        statusText: response.statusText,
        contentType,
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        acceptRanges: response.headers.get("accept-ranges"),
        bodyBase64: btoa(binary),
      };
    }, target.toString());

    session.expiresAt = Date.now() + 10 * 60 * 1000;
    const headers = new Headers({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "X-HLSTest-Browser-Session": "true",
      "Content-Type": payload.contentType,
    });

    if (payload.kind === "manifest") {
      const rewritten = rewriteBrowserManifest(payload.body, target, request.nextUrl.origin, sessionId);
      return new NextResponse(rewritten, { status: payload.status, headers });
    }

    const body = Buffer.from(payload.bodyBase64, "base64");
    // surrit serves MPEG-TS bytes as *.jpeg with image/jpeg. Safari is stricter
    // than hls.js about the segment MIME, so correct it from the TS sync byte.
    if (payload.contentType.toLowerCase().includes("image/jpeg") && body[0] === 0x47) {
      headers.set("Content-Type", "video/mp2t");
    }

    if (payload.contentLength) headers.set("Content-Length", String(body.byteLength));
    if (payload.contentRange) headers.set("Content-Range", payload.contentRange);
    if (payload.acceptRanges) headers.set("Accept-Ranges", payload.acceptRanges);

    return new NextResponse(body, {
      status: payload.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Browser media proxy failed" },
      { status: 502 },
    );
  }
}
