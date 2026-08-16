import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAvdbPlaybackSource } from "@/lib/avdb-playback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_ID = "751637c3-550d-416c-9c50-a0678d18e453";
const CATALOG_ID = "113a736a-fb5d-46cd-9d60-31c147ed7c2c";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function host(raw: string | null | undefined) {
  try {
    return raw ? new URL(raw).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  const url = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key || !token) return NextResponse.json({ ok: false, error: "retest unavailable" }, { status: 403 });

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runResponse = await db.from("avdb_stage_runs").select("metadata").eq("id", RUN_ID).maybeSingle();
  const metadata = (runResponse.data?.metadata || {}) as Record<string, unknown>;
  const expected = String(metadata.upload18_retest_hash || "");
  const expiresAt = Date.parse(String(metadata.upload18_retest_expires_at || ""));
  if (!expected || !safeEqual(hash(token), expected) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "retest token expired" }, { status: 403 });
  }

  const consume = await db.from("avdb_stage_runs").update({
    metadata: {
      ...metadata,
      upload18_retest_hash: null,
      upload18_retest_expires_at: null,
      upload18_retest_used_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq("id", RUN_ID);
  if (consume.error) return NextResponse.json({ ok: false, error: "cannot consume retest token" }, { status: 500 });

  try {
    const source = await fetchAvdbPlaybackSource(CATALOG_ID);
    const browserSessionUrl = new URL("/api/browser-session", request.nextUrl.origin);
    const sessionResponse = await fetch(browserSessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageUrl: source.playerPageUrl, forceFresh: true }),
      cache: "no-store",
    });
    const payload = await sessionResponse.json().catch(() => ({})) as {
      ok?: boolean;
      error?: string;
      failureType?: string;
      session?: { mediaUrl?: string; expiresAt?: number };
    };

    return NextResponse.json({
      ok: Boolean(sessionResponse.ok && payload.ok && payload.session),
      status: sessionResponse.status,
      failureType: payload.failureType || null,
      error: payload.error || null,
      provider: source.playerProvider,
      mediaHost: host(payload.session?.mediaUrl),
      expiresAt: payload.session?.expiresAt || null,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 500,
      failureType: "retest",
      error: error instanceof Error ? error.message : "Upload18 retest failed",
      provider: "upload18.org",
      mediaHost: null,
      expiresAt: null,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
