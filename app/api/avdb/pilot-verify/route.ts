import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyNextAvdbPlayer } from "@/lib/avdb-player-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const runId = String(request.nextUrl.searchParams.get("run") || "").trim();
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  if (!runId || !token) return NextResponse.json({ ok: false, error: "missing pilot token" }, { status: 400 });

  const url = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return NextResponse.json({ ok: false, error: "staging unavailable" }, { status: 503 });

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runResponse = await db.from("avdb_stage_runs").select("id,status,metadata").eq("id", runId).maybeSingle();
  if (runResponse.error || !runResponse.data) return NextResponse.json({ ok: false, error: "pilot run not found" }, { status: 404 });

  const metadata = (runResponse.data.metadata || {}) as Record<string, unknown>;
  const expected = String(metadata.pilot_verify_token_hash || "");
  const remaining = Math.max(0, Number(metadata.pilot_verify_remaining || 0));
  const expiresAt = Date.parse(String(metadata.pilot_verify_expires_at || ""));
  if (!expected || !safeEqual(hash(token), expected) || remaining < 1 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "pilot token expired" }, { status: 403 });
  }
  if (runResponse.data.status !== "completed") {
    return NextResponse.json({ ok: false, error: "pilot crawler not completed" }, { status: 409 });
  }

  const nextRemaining = remaining - 1;
  const nextMetadata = {
    ...metadata,
    pilot_verify_remaining: nextRemaining,
    pilot_verify_last_used_at: new Date().toISOString(),
    ...(nextRemaining === 0 ? { pilot_verify_token_hash: null } : {}),
  };
  const consume = await db.from("avdb_stage_runs").update({ metadata: nextMetadata, updated_at: new Date().toISOString() }).eq("id", runId);
  if (consume.error) return NextResponse.json({ ok: false, error: "cannot consume pilot token" }, { status: 500 });

  try {
    // The preview runner only controls the pilot. Playback verification itself
    // is executed against the public production origin so Vercel Preview
    // Protection cannot intercept the internal Browser Session request.
    const result = await verifyNextAvdbPlayer({ origin: "https://hlstest.vercel.app", runId, includeFailed: false });
    const checked = result.result;
    return NextResponse.json({
      ok: true,
      remaining: nextRemaining,
      done: result.done,
      result: checked
        ? {
            itemId: checked.itemId,
            movieCode: checked.movieCode,
            title: checked.title,
            playerStatus: checked.playerStatus,
            stageStatus: checked.stageStatus,
            failureType: checked.failureType,
            error: checked.error,
            elapsedMs: checked.elapsedMs,
          }
        : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, remaining: nextRemaining, error: error instanceof Error ? error.message : "pilot verify failed" }, { status: 500 });
  }
}
