import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AvdbRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type AvdbStageStatus = "discovered" | "staged" | "duplicate" | "player_check" | "player_ready" | "published" | "error";
export type AvdbPlayerStatus = "unverified" | "checking" | "ready" | "failed" | "blocked";

export type AvdbStageRun = {
  id: string;
  source: string;
  status: AvdbRunStatus;
  start_page: number;
  end_page: number;
  current_page: number;
  checkpoint_page: number | null;
  concurrency: number;
  retry_limit: number;
  pages_scanned: number;
  items_discovered: number;
  items_staged: number;
  duplicates_found: number;
  player_ready: number;
  published_count: number;
  failed_count: number;
  last_error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  paused_at: string | null;
  resumed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AvdbStageItem = {
  id: string;
  run_id: string | null;
  source_page: number | null;
  source_page_url: string | null;
  api_url: string | null;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  year: string | null;
  quality: string | null;
  duration: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_page_url: string | null;
  player_provider: string | null;
  player_status: AvdbPlayerStatus;
  stage_status: AvdbStageStatus;
  dedupe_key: string | null;
  duplicate_of: string | null;
  last_error: string | null;
  updated_at: string;
};

export type AvdbStageLog = {
  id: number;
  run_id: string | null;
  level: "debug" | "info" | "warn" | "error" | "success";
  step: string;
  message: string;
  context: Record<string, unknown>;
  created_at: string;
};

type AvdbClient = SupabaseClient;
let client: AvdbClient | null | undefined;

function getConfig() {
  return {
    url:
      process.env.HLSHUB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

export function isAvdbStagingConfigured() {
  return Boolean(getConfig().key);
}

function getAvdbClient() {
  const config = getConfig();
  if (!config.key) return null;
  client ??= createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function countRows(db: AvdbClient, table: string, filter?: { column: string; values: string[] }) {
  let query = db.from(table).select("id", { count: "exact", head: true });
  if (filter) query = query.in(filter.column, filter.values);
  const response = await query;
  if (response.error) throw new Error(response.error.message);
  return response.count || 0;
}

async function addRunLog(
  db: AvdbClient,
  runId: string | null,
  level: AvdbStageLog["level"],
  step: string,
  message: string,
  context: Record<string, unknown> = {},
) {
  const response = await db.from("avdb_stage_logs").insert({
    run_id: runId,
    level,
    step,
    message,
    context,
  });
  if (response.error) throw new Error(response.error.message);
}

export async function fetchAvdbAdminState() {
  const db = getAvdbClient();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const [latestRunResponse, itemResponse, logResponse, discovered, staging, duplicates, playerReady, published, failed] =
    await Promise.all([
      db.from("avdb_stage_runs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db
        .from("avdb_stage_items")
        .select(
          "id,run_id,source_page,source_page_url,api_url,external_id,movie_code,title,year,quality,duration,poster_url,thumb_url,player_page_url,player_provider,player_status,stage_status,dedupe_key,duplicate_of,last_error,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(80),
      db
        .from("avdb_stage_logs")
        .select("id,run_id,level,step,message,context,created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      countRows(db, "avdb_stage_items"),
      countRows(db, "avdb_stage_items", { column: "stage_status", values: ["discovered", "staged"] }),
      countRows(db, "avdb_stage_items", { column: "stage_status", values: ["duplicate"] }),
      countRows(db, "avdb_stage_items", { column: "stage_status", values: ["player_ready"] }),
      countRows(db, "avdb_stage_items", { column: "stage_status", values: ["published"] }),
      countRows(db, "avdb_stage_items", { column: "stage_status", values: ["error"] }),
    ]);

  if (latestRunResponse.error) throw new Error(latestRunResponse.error.message);
  if (itemResponse.error) throw new Error(itemResponse.error.message);
  if (logResponse.error) throw new Error(logResponse.error.message);

  return {
    configured: true,
    crawlerConnected: false,
    latestRun: (latestRunResponse.data || null) as AvdbStageRun | null,
    items: (itemResponse.data || []) as AvdbStageItem[],
    logs: (logResponse.data || []) as AvdbStageLog[],
    stats: {
      discovered,
      staging,
      duplicates,
      playerReady,
      published,
      failed,
    },
  };
}

export async function createAvdbRun(input: {
  startPage: unknown;
  endPage: unknown;
  concurrency?: unknown;
  retryLimit?: unknown;
}) {
  const db = getAvdbClient();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const startPage = clampInt(input.startPage, 1, 10262, 1);
  const endPage = clampInt(input.endPage, 1, 10262, startPage);
  if (endPage < startPage) throw new Error("หน้าสิ้นสุดต้องไม่น้อยกว่าหน้าเริ่มต้น");

  const concurrency = clampInt(input.concurrency, 1, 3, 1);
  const retryLimit = clampInt(input.retryLimit, 0, 5, 2);

  const activeResponse = await db
    .from("avdb_stage_runs")
    .select("id,status,start_page,end_page,current_page,checkpoint_page,created_at")
    .in("status", ["queued", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeResponse.error) throw new Error(activeResponse.error.message);
  if (activeResponse.data) {
    throw new Error(`มี AVDB run ที่ยังไม่จบอยู่แล้ว (${activeResponse.data.status})`);
  }

  const createdAt = nowIso();
  const response = await db
    .from("avdb_stage_runs")
    .insert({
      source: "avdbapi",
      status: "queued",
      start_page: startPage,
      end_page: endPage,
      current_page: startPage,
      checkpoint_page: null,
      concurrency,
      retry_limit: retryLimit,
      metadata: {
        crawler_connected: false,
        control_api_ready: true,
        requested_at: createdAt,
      },
      updated_at: createdAt,
    })
    .select("*")
    .single();

  if (response.error) throw new Error(response.error.message);
  const run = response.data as AvdbStageRun;
  await addRunLog(
    db,
    run.id,
    "success",
    "control",
    `สร้าง run หน้า ${startPage}-${endPage} แล้ว รอเชื่อม crawler ก่อนเริ่มอ่านต้นทาง`,
    { startPage, endPage, concurrency, retryLimit },
  );
  return run;
}

export async function controlAvdbRun(input: {
  runId: unknown;
  action: unknown;
  checkpointPage?: unknown;
  currentPage?: unknown;
  lastError?: unknown;
}) {
  const db = getAvdbClient();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const runId = String(input.runId || "").trim();
  const action = String(input.action || "").trim().toLowerCase();
  if (!runId) throw new Error("ไม่พบ runId");

  const existingResponse = await db.from("avdb_stage_runs").select("*").eq("id", runId).maybeSingle();
  if (existingResponse.error) throw new Error(existingResponse.error.message);
  if (!existingResponse.data) throw new Error("ไม่พบ AVDB run นี้");
  const existing = existingResponse.data as AvdbStageRun;

  const updatedAt = nowIso();
  let patch: Record<string, unknown> = { updated_at: updatedAt };
  let level: AvdbStageLog["level"] = "info";
  let message = "";

  if (action === "pause") {
    if (!["queued", "running"].includes(existing.status)) throw new Error(`หยุด run สถานะ ${existing.status} ไม่ได้`);
    patch = { ...patch, status: "paused", paused_at: updatedAt };
    message = `Pause ที่หน้า ${existing.current_page}`;
  } else if (action === "resume") {
    if (existing.status !== "paused") throw new Error(`Resume run สถานะ ${existing.status} ไม่ได้`);
    patch = { ...patch, status: "queued", resumed_at: updatedAt };
    level = "success";
    message = `Resume จาก checkpoint ${existing.checkpoint_page ?? existing.current_page}`;
  } else if (action === "checkpoint") {
    const currentPage = clampInt(input.currentPage, existing.start_page, existing.end_page, existing.current_page);
    const checkpointPage = clampInt(input.checkpointPage, existing.start_page, existing.end_page, currentPage);
    patch = { ...patch, current_page: currentPage, checkpoint_page: checkpointPage };
    message = `บันทึก checkpoint หน้า ${checkpointPage}`;
  } else if (action === "cancel") {
    if (["completed", "cancelled"].includes(existing.status)) throw new Error(`ยกเลิก run สถานะ ${existing.status} ไม่ได้`);
    patch = { ...patch, status: "cancelled", finished_at: updatedAt };
    level = "warn";
    message = `ยกเลิก run ที่หน้า ${existing.current_page}`;
  } else if (action === "fail") {
    patch = {
      ...patch,
      status: "failed",
      last_error: String(input.lastError || "AVDB run failed"),
      finished_at: updatedAt,
    };
    level = "error";
    message = `Run failed: ${String(input.lastError || "unknown error")}`;
  } else {
    throw new Error("action ต้องเป็น pause, resume, checkpoint, cancel หรือ fail");
  }

  const response = await db.from("avdb_stage_runs").update(patch).eq("id", runId).select("*").single();
  if (response.error) throw new Error(response.error.message);

  await addRunLog(db, runId, level, "control", message, { action });
  return response.data as AvdbStageRun;
}
