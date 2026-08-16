import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { fetchAvdbHtmlDetailForTest } from "@/lib/avdb-html-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BrowserSessionPayload = {
  ok?: boolean;
  cache?: "hit" | "miss" | string;
  error?: string;
  failureType?: "chromium" | "player" | "auth";
  session?: {
    sessionId: string;
    mediaUrl: string;
    proxyUrl?: string | null;
    expiresAt: number;
    diagnostics?: unknown;
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
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const item = await fetchAvdbHtmlDetailForTest(body?.id);
    if (!item.playerUrl) {
      return NextResponse.json({
        ok: true,
        result: {
          ok: false,
          failureType: "player",
          error: "รายการนี้ไม่มี Player URL จาก AVDB detail API",
          provider: item.playerProvider,
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const browserSessionUrl = new URL("/api/browser-session", request.nextUrl.origin);
    const sessionResponse = await fetch(browserSessionUrl, {
      method: "POST",
      headers: forwardHeaders(request),
      body: JSON.stringify({
        pageUrl: item.playerUrl,
        forceFresh: body?.forceFresh === true,
      }),
      cache: "no-store",
    });
    const payload = (await sessionResponse.json().catch(() => ({}))) as BrowserSessionPayload;

    if (!sessionResponse.ok || !payload.ok || !payload.session) {
      return NextResponse.json({
        ok: true,
        result: {
          ok: false,
          failureType: payload.failureType || "player",
          error: payload.error || "ตรวจ Player ไม่ผ่าน",
          provider: item.playerProvider,
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const session = payload.session;
    const playbackUrl = session.proxyUrl || (() => {
      const url = new URL("/api/browser-session", request.nextUrl.origin);
      url.searchParams.set("session", session.sessionId);
      url.searchParams.set("url", session.mediaUrl);
      return `${url.pathname}${url.search}`;
    })();

    return NextResponse.json({
      ok: true,
      result: {
        ok: true,
        provider: item.playerProvider,
        cache: payload.cache || "miss",
        playbackUrl,
        expiresAt: session.expiresAt,
        diagnostics: session.diagnostics || null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ตรวจ Player ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
