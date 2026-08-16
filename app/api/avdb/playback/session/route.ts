import { NextRequest, NextResponse } from "next/server";
import { fetchAvdbPlaybackSource } from "@/lib/avdb-playback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BrowserSessionPayload = {
  ok?: boolean;
  error?: string;
  failureType?: "chromium" | "player";
  session?: {
    sessionId: string;
    mediaUrl: string;
    proxyUrl?: string | null;
    expiresAt: number;
  };
};

function forwardHeaders(request: NextRequest) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["cookie", "authorization", "x-vercel-protection-bypass"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const catalogId = String(body?.catalogId || "").trim();
    const forceFresh = body?.forceFresh === true;
    if (!catalogId) {
      return NextResponse.json({ ok: false, error: "ไม่พบรหัส AVDB" }, { status: 400 });
    }

    const source = await fetchAvdbPlaybackSource(catalogId);
    const browserSessionUrl = new URL("/api/browser-session", request.nextUrl.origin);
    const sessionResponse = await fetch(browserSessionUrl, {
      method: "POST",
      headers: forwardHeaders(request),
      body: JSON.stringify({
        pageUrl: source.playerPageUrl,
        forceFresh,
      }),
      cache: "no-store",
    });

    const sessionPayload = (await sessionResponse.json().catch(() => ({}))) as BrowserSessionPayload;
    if (!sessionResponse.ok || !sessionPayload.ok || !sessionPayload.session) {
      return NextResponse.json(
        {
          ok: false,
          error: sessionPayload.error || "ยังเปิด AVDB Player ไม่ได้",
          failureType: sessionPayload.failureType || "player",
        },
        { status: sessionResponse.status >= 400 ? sessionResponse.status : 502 },
      );
    }

    const session = sessionPayload.session;
    const playbackUrl = session.proxyUrl || (() => {
      const url = new URL("/api/browser-session", request.nextUrl.origin);
      url.searchParams.set("session", session.sessionId);
      url.searchParams.set("url", session.mediaUrl);
      return `${url.pathname}${url.search}`;
    })();

    return NextResponse.json(
      {
        ok: true,
        session: {
          playbackUrl,
          expiresAt: session.expiresAt,
          provider: source.playerProvider,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "สร้าง AVDB Playback Session ไม่สำเร็จ";
    const status = /Public Catalog|ไม่พบ|ไม่ได้อยู่ในสถานะ|ไม่มี Player/.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
