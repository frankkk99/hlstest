import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAvdbPlayerItem } from "@/lib/avdb-player-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_ID = "751637c3-550d-416c-9c50-a0678d18e453";
const ITEM_ID = "a993bd1b-b268-48c4-aaae-4fb9fb3793cb";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function host(raw: string | null) {
  if (!raw) return null;
  try { return new URL(raw).hostname.toLowerCase(); } catch { return null; }
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  const url = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key || !token) return NextResponse.json({ ok: false, error: "smoke test unavailable" }, { status: 403 });

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runResponse = await db.from("avdb_stage_runs").select("metadata").eq("id", RUN_ID).maybeSingle();
  const metadata = (runResponse.data?.metadata || {}) as Record<string, unknown>;
  const expected = String(metadata.upload18_auth_smoke_hash || "");
  const expiresAt = Date.parse(String(metadata.upload18_auth_smoke_expires_at || ""));
  if (!expected || !safeEqual(hash(token), expected) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "smoke token expired" }, { status: 403 });
  }

  const nextMetadata = {
    ...metadata,
    upload18_auth_smoke_hash: null,
    upload18_auth_smoke_used_at: new Date().toISOString(),
  };
  const consume = await db.from("avdb_stage_runs").update({ metadata: nextMetadata, updated_at: new Date().toISOString() }).eq("id", RUN_ID);
  if (consume.error) return NextResponse.json({ ok: false, error: "cannot consume smoke token" }, { status: 500 });

  try {
    const result = await verifyAvdbPlayerItem({
      itemId: ITEM_ID,
      origin: "https://hlstest.vercel.app",
      forceFresh: true,
    });
    return NextResponse.json({
      ok: true,
      result: {
        itemId: result.itemId,
        movieCode: result.movieCode,
        playerStatus: result.playerStatus,
        stageStatus: result.stageStatus,
        failureType: result.failureType,
        error: result.error,
        mediaHost: host(result.mediaUrl),
        elapsedMs: result.elapsedMs,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Upload18 smoke test failed" }, { status: 500 });
  }
}
