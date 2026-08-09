import { NextRequest, NextResponse } from "next/server";
import {
  buildUpstreamHeaders,
  proxyEnabled,
  validateUpstreamUrl,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeBody = {
  url?: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
  testSegment?: boolean;
};

function expiryInfo(url: URL) {
  const raw = url.searchParams.get("e") || url.searchParams.get("expires") || url.searchParams.get("x");
  if (!raw || !/^\d{9,13}$/.test(raw)) return null;

  let value = Number(raw);
  if (value > 10_000_000_000) value = Math.floor(value / 1000);
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return {
    unix: value,
    iso: date.toISOString(),
    expired: Date.now() >= date.getTime(),
    secondsRemaining: Math.floor((date.getTime() - Date.now()) / 1000),
  };
}

function resolveFirstMediaUrl(manifest: string, base: URL): string | null {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const mediaLine = lines.find((line) => line && !line.startsWith("#"));
  if (!mediaLine) return null;
  try {
    return new URL(mediaLine, base).toString();
  } catch {
    return null;
  }
}

function manifestInfo(text: string) {
  const lines = text.split(/\r?\n/);
  const extinfCount = lines.filter((line) => line.startsWith("#EXTINF:")).length;
  const variantCount = lines.filter((line) => line.startsWith("#EXT-X-STREAM-INF:")).length;
  const targetDuration = lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"))?.split(":")[1] || null;
  const playlistType = lines.find((line) => line.startsWith("#EXT-X-PLAYLIST-TYPE:"))?.split(":")[1] || null;
  const canary = lines.find((line) => line.startsWith("#U18-CANARY:"))?.slice("#U18-CANARY:".length) || null;
  const hasEndList = lines.some((line) => line.trim() === "#EXT-X-ENDLIST");
  const encrypted = lines.some((line) => line.startsWith("#EXT-X-KEY:"));

  return {
    extinfCount,
    variantCount,
    targetDuration,
    playlistType,
    canary,
    hasEndList,
    encrypted,
    preview: lines.slice(0, 32).join("\n"),
  };
}

async function fetchUpstream(url: URL, headers: Headers) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current };
      current = validateUpstreamUrl(new URL(location, current).toString());
      continue;
    }

    return { response, finalUrl: current };
  }
  throw new Error("Redirect มากเกินไป");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ProbeBody;
    if (!body.url) {
      return NextResponse.json({ ok: false, error: "กรุณาใส่ Manifest URL" }, { status: 400 });
    }

    const url = validateUpstreamUrl(body.url);
    const headers = buildUpstreamHeaders({
      origin: body.origin,
      referer: body.referer,
      userAgent: body.userAgent,
    });

    const startedAt = Date.now();
    const { response, finalUrl } = await fetchUpstream(url, headers);
    const elapsedMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";
    const requestId = response.headers.get("x-request-id");
    const u18Cache = response.headers.get("x-u18-cache");
    const u18Guard = response.headers.get("x-u18-guard");
    const allowOrigin = response.headers.get("access-control-allow-origin");
    const text = await response.text();
    const isHls = text.trimStart().startsWith("#EXTM3U") || /mpegurl/i.test(contentType);
    const parsed = isHls ? manifestInfo(text) : null;

    let segmentTest: Record<string, unknown> | null = null;
    if (body.testSegment !== false && response.ok && isHls) {
      const firstUrl = resolveFirstMediaUrl(text, finalUrl);
      if (firstUrl) {
        try {
          const segmentUrl = validateUpstreamUrl(firstUrl);
          const segmentHeaders = buildUpstreamHeaders({
            origin: body.origin,
            referer: body.referer,
            userAgent: body.userAgent,
            range: "bytes=0-4095",
          });
          const segmentStart = Date.now();
          const segmentResponse = await fetch(segmentUrl, {
            method: "GET",
            headers: segmentHeaders,
            redirect: "manual",
            cache: "no-store",
          });
          const bytes = new Uint8Array(await segmentResponse.arrayBuffer());
          segmentTest = {
            url: segmentUrl.toString(),
            status: segmentResponse.status,
            ok: segmentResponse.ok,
            contentType: segmentResponse.headers.get("content-type"),
            contentRange: segmentResponse.headers.get("content-range"),
            requestId: segmentResponse.headers.get("x-request-id"),
            u18Cache: segmentResponse.headers.get("x-u18-cache"),
            u18Guard: segmentResponse.headers.get("x-u18-guard"),
            bytesReceived: bytes.byteLength,
            elapsedMs: Date.now() - segmentStart,
          };
        } catch (error) {
          segmentTest = {
            ok: false,
            error: error instanceof Error ? error.message : "Segment test failed",
          };
        }
      }
    }

    const expiry = expiryInfo(finalUrl);
    const bindingHints = {
      ip: finalUrl.searchParams.has("i"),
      browser: finalUrl.searchParams.has("d"),
      signature: finalUrl.searchParams.has("h"),
      session: finalUrl.searchParams.has("s") || finalUrl.searchParams.has("k"),
    };

    return NextResponse.json({
      ok: response.ok && isHls,
      manifest: {
        requestedUrl: url.toString(),
        finalUrl: finalUrl.toString(),
        status: response.status,
        statusText: response.statusText,
        contentType,
        contentLength: response.headers.get("content-length"),
        allowOrigin,
        requestId,
        u18Cache,
        u18Guard,
        elapsedMs,
        isHls,
        bytes: Buffer.byteLength(text),
        expiry,
        bindingHints,
        ...parsed,
      },
      segmentTest,
      proxyEnabled: proxyEnabled(),
      serverNote:
        "การทดสอบนี้ยิงจากเครื่อง/เซิร์ฟเวอร์ที่รัน Next.js หาก signed URL ผูก IP ผลบน Vercel อาจต่างจากเครื่องผู้ใช้",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Probe failed" },
      { status: 400 },
    );
  }
}
