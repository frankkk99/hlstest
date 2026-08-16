import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AvdbPlayerVerificationResult = {
  ok: boolean;
  itemId: string;
  movieCode: string | null;
  title: string;
  playerPageUrl: string | null;
  playerStatus: "ready" | "failed";
  stageStatus: "player_ready" | "player_check";
  mediaUrl: string | null;
  failureType: string | null;
  error: string | null;
  diagnostics: Record<string, unknown>;
  elapsedMs: number;
};

type StageItemRow = {
  id: string;
  run_id: string | null;
  movie_code: string | null;
  title: string;
  player_page_url: string | null;
  player_provider: string | null;
  player_status: "unverified" | "checking" | "ready" | "failed" | "blocked";
  stage_status: "discovered" | "staged" | "duplicate" | "player_check" | "player_ready" | "published" | "error";
  verified_media_url: string | null;
};

let client: SupabaseClient | null | undefined;
let verificationQueue: Promise<unknown> = Promise.resolve();

function getConfig() {
  return {
    url:
      process.env.HLSHUB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function getDb() {
  const config = getConfig();
  if (!config.key) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");
  client ??= createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

function nowIso() {
  return new Date().toISOString();
}

function enqueue<T>(operation: () => Promise<T>) {
  const result = verificationQueue.then(operation, operation);
  verificationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function addLog(
  db: SupabaseClient,
  runId: string | null,
  level: "debug" | "info" | "warn" | "error" | "success",
  message: string,
  context: Record<string, unknown> = {},
) {
  const response = await db.from("avdb_stage_logs").insert({
    run_id: runId,
    level,
    step: "player",
    message,
    context,
  });
  if (response.error) throw new Error(response.error.message);
}

async function refreshRunPlayerReady(db: SupabaseClient, runId: string | null) {
  if (!runId) return;
  const countResponse = await db
    .from("avdb_stage_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("player_status", "ready")
    .eq("stage_status", "player_ready");
  if (countResponse.error) throw new Error(countResponse.error.message);

  const updateResponse = await db
    .from("avdb_stage_runs")
    .update({ player_ready: countResponse.count || 0, updated_at: nowIso() })
    .eq("id", runId);
  if (updateResponse.error) throw new Error(updateResponse.error.message);
}

async function fetchStageItem(db: SupabaseClient, itemId: string) {
  const response = await db
    .from("avdb_stage_items")
    .select(
      "id,run_id,movie_code,title,player_page_url,player_provider,player_status,stage_status,verified_media_url",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error("ไม่พบ AVDB staging item นี้");
  return response.data as StageItemRow;
}

async function markFailed(
  db: SupabaseClient,
  item: StageItemRow,
  started: number,
  failureType: string,
  error: string,
  diagnostics: Record<string, unknown> = {},
): Promise<AvdbPlayerVerificationResult> {
  const checkedAt = nowIso();
  const response = await db
    .from("avdb_stage_items")
    .update({
      player_status: "failed",
      stage_status: "player_check",
      player_checked_at: checkedAt,
      player_failure_type: failureType,
      player_diagnostics: diagnostics,
      last_error: error,
      updated_at: checkedAt,
    })
    .eq("id", item.id);
  if (response.error) throw new Error(response.error.message);

  await addLog(
    db,
    item.run_id,
    "error",
    `${item.movie_code || item.title || item.id} Player ไม่ผ่าน: ${error}`,
    { itemId: item.id, failureType, playerPageUrl: item.player_page_url, diagnostics },
  );
  await refreshRunPlayerReady(db, item.run_id);

  return {
    ok: false,
    itemId: item.id,
    movieCode: item.movie_code,
    title: item.title,
    playerPageUrl: item.player_page_url,
    playerStatus: "failed",
    stageStatus: "player_check",
    mediaUrl: null,
    failureType,
    error,
    diagnostics,
    elapsedMs: Date.now() - started,
  };
}

async function verifyItemInternal(input: {
  itemId: string;
  origin: string;
  forceFresh?: boolean;
}): Promise<AvdbPlayerVerificationResult> {
  const db = getDb();
  const item = await fetchStageItem(db, input.itemId);
  const started = Date.now();

  if (item.stage_status === "duplicate") {
    return markFailed(db, item, started, "duplicate", "รายการนี้ถูกจัดเป็น Duplicate จึงไม่ตรวจ Player");
  }
  if (item.stage_status === "published") {
    throw new Error("รายการนี้ Publish แล้ว ไม่ควรเปลี่ยนสถานะจาก Player verifier");
  }

  const checkingAt = nowIso();
  const checkingResponse = await db
    .from("avdb_stage_items")
    .update({
      player_status: "checking",
      stage_status: "player_check",
      last_error: null,
      player_failure_type: null,
      updated_at: checkingAt,
    })
    .eq("id", item.id);
  if (checkingResponse.error) throw new Error(checkingResponse.error.message);

  if (!item.player_page_url) {
    return markFailed(db, item, started, "missing-player", "ไม่พบ player_page_url จาก AVDBAPI");
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/api/browser-session", input.origin);
  } catch {
    return markFailed(db, item, started, "internal", "ไม่สามารถสร้าง Browser Session endpoint ได้");
  }

  let payload: any = null;
  let response: Response | null = null;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        pageUrl: item.player_page_url,
        mediaUrl: item.verified_media_url || "",
        forceFresh: input.forceFresh !== false,
      }),
    });
    payload = await response.json();
  } catch (error) {
    return markFailed(
      db,
      item,
      started,
      "chromium",
      error instanceof Error ? error.message : "เรียก Browser Session ไม่สำเร็จ",
    );
  }

  if (!response.ok || !payload?.ok || !payload?.session?.mediaUrl) {
    const failureType = String(payload?.failureType || "player");
    const error = String(payload?.error || `Browser Session HTTP ${response.status}`);
    return markFailed(db, item, started, failureType, error, {
      attempts: payload?.attempts ?? null,
      pageStatus: payload?.pageStatus ?? null,
      captured: payload?.captured ?? [],
    });
  }

  const mediaUrl = String(payload.session.mediaUrl);
  const diagnostics = {
    manifest: payload.session.diagnostics?.manifest || null,
    segment: payload.session.diagnostics?.segment || null,
    pageStatus: payload.pageStatus ?? null,
    finalPageUrl: payload.finalPageUrl || item.player_page_url,
    captured: Array.isArray(payload.captured) ? payload.captured.slice(0, 10) : [],
    provider: item.player_provider,
  };
  const checkedAt = nowIso();
  const readyResponse = await db
    .from("avdb_stage_items")
    .update({
      player_status: "ready",
      stage_status: "player_ready",
      verified_media_url: mediaUrl,
      player_checked_at: checkedAt,
      player_failure_type: null,
      player_diagnostics: diagnostics,
      last_error: null,
      updated_at: checkedAt,
    })
    .eq("id", item.id);
  if (readyResponse.error) throw new Error(readyResponse.error.message);

  await addLog(
    db,
    item.run_id,
    "success",
    `${item.movie_code || item.title || item.id} Player READY`,
    {
      itemId: item.id,
      playerPageUrl: item.player_page_url,
      mediaUrl,
      diagnostics,
    },
  );
  await refreshRunPlayerReady(db, item.run_id);

  return {
    ok: true,
    itemId: item.id,
    movieCode: item.movie_code,
    title: item.title,
    playerPageUrl: item.player_page_url,
    playerStatus: "ready",
    stageStatus: "player_ready",
    mediaUrl,
    failureType: null,
    error: null,
    diagnostics,
    elapsedMs: Date.now() - started,
  };
}

export function verifyAvdbPlayerItem(input: { itemId: string; origin: string; forceFresh?: boolean }) {
  return enqueue(() => verifyItemInternal(input));
}

export async function verifyNextAvdbPlayer(input: {
  origin: string;
  includeFailed?: boolean;
  runId?: string | null;
}) {
  return enqueue(async () => {
    const db = getDb();
    const statuses = input.includeFailed ? ["unverified", "failed"] : ["unverified"];
    let query = db
      .from("avdb_stage_items")
      .select("id,movie_code,title,player_status,stage_status,updated_at")
      .eq("source", "avdbapi")
      .in("player_status", statuses)
      .in("stage_status", ["discovered", "staged", "player_check"])
      .order("source_page", { ascending: true, nullsFirst: false })
      .order("first_seen_at", { ascending: true })
      .limit(1);

    if (input.runId) query = query.eq("run_id", input.runId);
    const response = await query.maybeSingle();
    if (response.error) throw new Error(response.error.message);
    if (!response.data) {
      return { ok: true, done: true, continue: false, result: null };
    }

    const result = await verifyItemInternal({
      itemId: String(response.data.id),
      origin: input.origin,
      forceFresh: true,
    });
    return {
      ok: true,
      done: false,
      continue: true,
      result,
    };
  });
}
