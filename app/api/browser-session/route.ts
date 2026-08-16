import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Page } from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";
import { createStreamToken } from "@/lib/stream-token";
import { ensureUpload18Authenticated } from "@/lib/upload18-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SOURCE_PAGE_HOSTS = ["missav123.com", "missav.com", "fourhoi.com", "upload18.org"];
const DEFAULT_MEDIA_HOSTS = ["surrit.com", "fourhoi.com", "helvid.com"];
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

type MediaDiagnostics = {
  manifest: { url: string; status: number; contentType: string; bytes: number };
  segment: { url: string; status: number; contentType: string; bytes: number };
};

type BrowserSessionState = {
  browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  page: Page;
  mediaUrl: string;
  finalPageUrl: string;
  proxyUrl: string | null;
  expiresAt: number;
  diagnostics: MediaDiagnostics;
};

type BrowserFailureType = "chromium" | "player" | "auth";

class BrowserSessionError extends Error {
  constructor(
    message: string,
    readonly failureType: BrowserFailureType,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

const sessions = new Map<string, BrowserSessionState>();
const sessionByPageUrl = new Map<string, string>();
type BrowserInstance = Awaited<ReturnType<typeof puppeteer.launch>>;
let sharedBrowser: BrowserInstance | null = null;
let sharedBrowserPromise: Promise<BrowserInstance> | null = null;
let browserOperationQueue: Promise<unknown> = Promise.resolve();

function enqueueBrowserOperation<T>(operation: () => Promise<T>) {
  const result = browserOperationQueue.then(operation, operation);
  browserOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

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
  try {
    return (
      isAllowedMediaUrl(raw) &&
      (/\.m3u8(?:$|\?)/i.test(raw) || /\/playlist(?:\/|\.|$)/i.test(new URL(raw).pathname))
    );
  } catch {
    return false;
  }
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

async function kickMediaPlayback(page: Page) {
  for (const frame of page.frames()) {
    await frame
      .evaluate(async () => {
        for (const video of Array.from(document.querySelectorAll("video")) as HTMLVideoElement[]) {
          video.muted = true;
          await video.play().catch(() => undefined);
        }
      })
      .catch((error) => {
        if (isRetryableBrowserError(error)) throw error;
      });
  }
}

async function waitForMedia(page: Page, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const frame of page.frames()) {
      const mediaUrls = await frame
        .evaluate(() => {
          const values = new Set<string>();
          for (const element of Array.from(document.querySelectorAll("video, source"))) {
            for (const attribute of ["src", "data-src"]) {
              const value = element.getAttribute(attribute);
              if (value) values.add(value);
            }
          }
          return [...values];
        })
        .catch(() => [] as string[]);
      if (mediaUrls.some(isManifestUrl)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function inspectManifestAndFirstSegment(page: Page, manifestUrl: string) {
  return page
    .evaluate(async (rootUrl) => {
      type Check = { url: string; status: number; contentType: string; bytes: number };
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 18000);

      try {
        async function fetchText(url: string) {
          const response = await fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal });
          const body = await response.text();
          return {
            response,
            body,
            check: {
              url,
              status: response.status,
              contentType: response.headers.get("content-type") || "",
              bytes: body.length,
            },
          };
        }

        function firstMediaUrl(body: string, baseUrl: string) {
          const map = body.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/i)?.[1];
          if (map) return new URL(map, baseUrl).toString();
          const line = body
            .split(/\r?\n/)
            .map((value) => value.trim())
            .find((value) => value && !value.startsWith("#"));
          return line ? new URL(line, baseUrl).toString() : null;
        }

        const root = await fetchText(rootUrl);
        if (!root.response.ok || (!/m3u8|mpegurl/i.test(root.check.contentType) && !/\.m3u8(?:$|\?)/i.test(rootUrl))) {
          return {
            ok: false as const,
            stage: "manifest" as const,
            error: `Manifest HTTP ${root.response.status}`,
            manifest: root.check,
          };
        }

        let playlistUrl = rootUrl;
        let playlistBody = root.body;
        let segmentUrl = firstMediaUrl(playlistBody, playlistUrl);
        for (let depth = 0; segmentUrl && /\.m3u8(?:$|\?)/i.test(segmentUrl) && depth < 3; depth += 1) {
          const child = await fetchText(segmentUrl);
          if (!child.response.ok) {
            return {
              ok: false as const,
              stage: "manifest" as const,
              error: `Variant manifest HTTP ${child.response.status}`,
              manifest: child.check,
            };
          }
          playlistUrl = segmentUrl;
          playlistBody = child.body;
          segmentUrl = firstMediaUrl(playlistBody, playlistUrl);
        }

        if (!segmentUrl) {
          return {
            ok: false as const,
            stage: "segment" as const,
            error: "ไม่พบ URI ของ segment แรกใน manifest",
            manifest: root.check,
          };
        }

        const segmentResponse = await fetch(segmentUrl, {
          credentials: "include",
          cache: "no-store",
          headers: { Range: "bytes=0-65535" },
          signal: controller.signal,
        });
        const segmentBytes = new Uint8Array(await segmentResponse.arrayBuffer());
        const segmentContentType = segmentResponse.headers.get("content-type") || "";
        const sample = new TextDecoder().decode(segmentBytes.subarray(0, 64)).trim().toLowerCase();
        const looksLikeHtml =
          /text\/html/i.test(segmentContentType) || sample.startsWith("<!doctype") || sample.startsWith("<html");
        const segment: Check = {
          url: segmentUrl,
          status: segmentResponse.status,
          contentType: segmentContentType,
          bytes: segmentBytes.byteLength,
        };
        if (!segmentResponse.ok || !segmentBytes.byteLength || looksLikeHtml) {
          return {
            ok: false as const,
            stage: "segment" as const,
            error: `Segment แรก HTTP ${segmentResponse.status} หรือไม่มีข้อมูลวิดีโอ`,
            manifest: root.check,
            segment,
          };
        }

        return { ok: true as const, manifest: root.check, segment };
      } finally {
        window.clearTimeout(timeout);
      }
    }, manifestUrl)
    .catch((error) => {
      throw new BrowserSessionError(
        error instanceof Error ? error.message : "ตรวจ manifest/segment ไม่สำเร็จ",
        "chromium",
        true,
      );
    });
}

function isRetryableBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /detached|target closed|browser.*(?:closed|disconnected)|insufficient[_ ]resources|execution context was destroyed|protocol error|frame was detached|navigation.*failed/i.test(
    message,
  );
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
    diagnostics: session.diagnostics,
  };
}

function upload18AuthMessage(reason: string | undefined) {
  if (reason === "credentials-missing") {
    return "Upload18 ต้องเข้าสู่ระบบก่อนเปิด Player — ยังไม่ได้ตั้งค่า UPLOAD18_USERNAME / UPLOAD18_PASSWORD บน Server";
  }
  if (reason === "login-failed") {
    return "Upload18 login ไม่สำเร็จ กรุณาตรวจสอบ UPLOAD18_USERNAME / UPLOAD18_PASSWORD";
  }
  if (reason === "session-not-persisted") {
    return "Upload18 login สำเร็จแต่ session ไม่คงอยู่เมื่อกลับไปหน้า Player";
  }
  return "Upload18 authentication ไม่สำเร็จ";
}

async function createBrowserSession(body: { pageUrl: string; userAgent: string; mediaHint: string; forceFresh: boolean }) {
  await cleanupExpiredSessions();
  const { pageUrl, userAgent, mediaHint, forceFresh } = body;

  if (!isAllowedSourcePage(pageUrl)) {
    return NextResponse.json(
      { ok: false, error: "URL หน้าเว็บไม่อยู่ใน source page allowlist", failureType: "player" as const },
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
  let page: Page | null = null;
  let storedSession = false;

  try {
    page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(12000);

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

    const navigation = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    let pageStatus = navigation?.status() ?? 0;

    const upload18Auth = await ensureUpload18Authenticated(page, pageUrl);
    if (!upload18Auth.authenticated) {
      throw new BrowserSessionError(upload18AuthMessage(upload18Auth.reason), "auth", false);
    }
    if (typeof upload18Auth.pageStatus === "number") pageStatus = upload18Auth.pageStatus;

    await new Promise((resolve) => setTimeout(resolve, mediaHint && isManifestUrl(mediaHint) ? 1000 : 1500));
    await kickMediaPlayback(page);

    const hintIsValid = Boolean(mediaHint && isManifestUrl(mediaHint));
    if (!hintIsValid) await waitForMedia(page, 12000);

    const finalPageUrl = page.url();
    const media = [...captured.values()].filter((item) => item.status < 400);
    const candidates = [
      ...(hintIsValid ? [{ url: mediaHint, status: 200, contentType: "application/vnd.apple.mpegurl" }] : []),
      ...media,
    ].filter((candidate, index, list) => list.findIndex((item) => item.url === candidate.url) === index);

    let manifest: { url: string; status: number; contentType: string } | null = null;
    let diagnostics: MediaDiagnostics | null = null;
    const failures: string[] = [];
    for (const candidate of candidates) {
      const check = await inspectManifestAndFirstSegment(page, candidate.url);
      if (check.ok) {
        manifest = candidate;
        diagnostics = check;
        break;
      }
      failures.push(`${candidate.url}: ${check.error}`);
    }

    if (!manifest || !diagnostics) {
      throw new BrowserSessionError(
        candidates.length
          ? `ตรวจ Player ไม่ผ่าน: manifest หรือ segment แรกใช้ไม่ได้${failures.length ? ` (${failures[0]})` : ""}`
          : "ไม่พบ HLS manifest หลังรอ Chromium 12 วินาที",
        "player",
        false,
      );
    }

    const cookie = await page
      .cookies(manifest.url)
      .then((items) => items.map((item) => `${item.name}=${item.value}`).join("; "))
      .catch(() => "");
    const sessionId = randomUUID();
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
      page,
      mediaUrl: manifest.url,
      finalPageUrl,
      proxyUrl,
      expiresAt,
      diagnostics,
    });
    sessionByPageUrl.set(pageUrl, sessionId);
    storedSession = true;

    return NextResponse.json({
      ok: true,
      sessionId,
      session: sessionPayload(sessionId, sessions.get(sessionId)!),
      pageStatus,
      finalPageUrl,
      captured: media.slice(0, 10),
    });
  } finally {
    if (!storedSession) await page?.close().catch(() => undefined);
  }
}

async function handleBrowserSession(request: NextRequest) {
  const body = await request.json();
  const payload = {
    pageUrl: String(body?.pageUrl || "").trim(),
    userAgent: String(body?.userAgent || DEFAULT_UA),
    mediaHint: String(body?.mediaUrl || "").trim(),
    forceFresh: body?.forceFresh === true,
  };

  let lastError: unknown = new Error("Browser session failed");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await createBrowserSession(payload);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof BrowserSessionError ? error.retryable : isRetryableBrowserError(error);
      if (!retryable || attempt >= 3) {
        const failureType: BrowserFailureType = error instanceof BrowserSessionError ? error.failureType : "chromium";
        return NextResponse.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Browser session failed",
            failureType,
            attempts: attempt,
          },
          { status: failureType === "auth" ? 401 : 502 },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: lastError instanceof Error ? lastError.message : "Browser session failed",
      failureType: "chromium" as const,
    },
    { status: 502 },
  );
}

export async function POST(request: NextRequest) {
  try {
    return await enqueueBrowserOperation(() => handleBrowserSession(request));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Browser session failed",
        failureType: "chromium" as const,
      },
      { status: 502 },
    );
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
