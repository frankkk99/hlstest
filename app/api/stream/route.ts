import { NextRequest, NextResponse } from "next/server";
import {
  buildUpstreamHeaders,
  proxyEnabled,
  validateUpstreamUrl,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function proxiedUrl(target: string, origin: string, referer: string, userAgent: string) {
  const params = new URLSearchParams({ url: target });
  if (origin) params.set("origin", origin);
  if (referer) params.set("referer", referer);
  if (userAgent) params.set("ua", userAgent);
  return `/api/stream?${params.toString()}`;
}

function rewriteManifest(
  text: string,
  base: URL,
  origin: string,
  referer: string,
  userAgent: string,
) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (!trimmed.startsWith("#")) {
        try {
          const absolute = new URL(trimmed, base).toString();
          return proxiedUrl(absolute, origin, referer, userAgent);
        } catch {
          return line;
        }
      }

      if (trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
          try {
            const absolute = new URL(value, base).toString();
            return `URI="${proxiedUrl(absolute, origin, referer, userAgent)}"`;
          } catch {
            return `URI="${value}"`;
          }
        });
      }

      return line;
    })
    .join("\n");
}

export async function GET(request: NextRequest) {
  if (!proxyEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Stream proxy ถูกปิดอยู่ ตั้ง ENABLE_STREAM_PROXY=true เฉพาะตอนรัน local/test",
      },
      { status: 403 },
    );
  }

  try {
    const raw = request.nextUrl.searchParams.get("url");
    if (!raw) {
      return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });
    }

    const origin = request.nextUrl.searchParams.get("origin") || "";
    const referer = request.nextUrl.searchParams.get("referer") || "";
    const userAgent = request.nextUrl.searchParams.get("ua") || "";
    const target = validateUpstreamUrl(raw);

    const upstreamHeaders = buildUpstreamHeaders({
      origin,
      referer,
      userAgent,
      range: request.headers.get("range"),
    });

    const upstream = await fetch(target, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "manual",
      cache: "no-store",
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location) {
        return new NextResponse(null, { status: upstream.status });
      }
      const redirected = validateUpstreamUrl(new URL(location, target).toString());
      const next = proxiedUrl(redirected.toString(), origin, referer, userAgent);
      return NextResponse.redirect(new URL(next, request.nextUrl.origin), 307);
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const looksLikeManifest = /mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(target.toString()) || target.pathname.startsWith("/m/") || target.pathname.startsWith("/p/");

    if (looksLikeManifest) {
      const body = await upstream.text();
      const isManifest = body.trimStart().startsWith("#EXTM3U");
      if (isManifest) {
        const rewritten = rewriteManifest(body, target, origin, referer, userAgent);
        return new NextResponse(rewritten, {
          status: upstream.status,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Access-Control-Allow-Origin": "*",
            "X-HLSTest-Upstream-Status": String(upstream.status),
          },
        });
      }

      return new NextResponse(body, {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "no-store");
    headers.set("Access-Control-Allow-Origin", "*");

    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    const requestId = upstream.headers.get("x-request-id");
    const guard = upstream.headers.get("x-u18-guard");
    if (requestId) headers.set("X-HLSTest-Request-Id", requestId);
    if (guard) headers.set("X-HLSTest-U18-Guard", guard);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Proxy failed" },
      { status: 400 },
    );
  }
}
