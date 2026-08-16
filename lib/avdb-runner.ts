import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildAvdbApiPageUrl, scanAvdbApiPage } from "@/lib/avdb-api-scanner";
import { type AvdbScanItem, type AvdbScanResult } from "@/lib/avdb-scanner";

export type AvdbWorkerResult = {
  ok: boolean;
  runId: string;
  status: string;
  pageNumber: number;
  pageUrl: string;
  itemsFound: number;
  inserted: number;
  updated: number;
  duplicates: number;
  elapsedMs: number;
  continue: boolean;
  message: string;
};

type RunRow = {
  id: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
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
  failed_count: number;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
};

type ExistingStageRow = {
  id: string;
  external_id: string | null;
  dedupe_key: string | null;
  stage_status: string;
  player_status: string;
};

let client: SupabaseClient | null | undefined;
let serialQueue = Promise.resolve();

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

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function dedupeKey(item: AvdbScanItem) {
  const code = normalizeKey(item.movieCode);
  if (code) return `code:${code}`;
  const slug = normalizeKey(item.slug);
  if (slug) return `slug:${slug}`;
  const title = normalizeKey(item.name);
  if (title) return `title:${title}`;
  return `api:${item.apiUrl}`;
}

async function addLog(
  db: SupabaseClient,
  runId: string,
  level: "debug" | "info" | "warn" | "error" | "success",
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

async function fetchRun(db: SupabaseClient, runId: string) {
  const response = await db.from("avdb_stage_runs").select("*").eq("id", runId).maybeSingle();
  if (response.error) throw new Error(response.error.message);
  if (!response.data) throw new Error("ไม่พบ AVDB run นี้");
  return response.data as RunRow;
}

async function markRunning(db: SupabaseClient, run: RunRow) {
  if (run.status === "running") return run;
  if (run.status !== "queued") throw new Error(`Worker เริ่ม run สถานะ ${run.status} ไม่ได้`);

  const updatedAt = nowIso();
  const response = await db
    .from("avdb_stage_runs")
    .update({
      status: "running",
      started_at: run.started_at || updatedAt,
      last_error: null,
      metadata: {
        ...(run.metadata || {}),
        crawler_connected: true,
        worker_mode: "admin-tab-serial",
        source_mode: "avdb-rest-api-pagination",
        worker_started_at: updatedAt,
      },
      updated_at: updatedAt,
    })
    .eq("id", run.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (response.error) throw new Error(response.error.message);
  if (!response.data) return fetchRun(db, run.id);
  await addLog(db, run.id, "success", "crawler", `เริ่ม API Worker จากหน้า ${run.current_page}`, {
    currentPage: run.current_page,
    sourceMode: "rest-api-pagination",
  });
  return response.data as RunRow;
}

async function loadExistingRows(db: SupabaseClient, items: AvdbScanItem[]) {
  const externalIds = [...new Set(items.map((item) => clean(item.id)).filter((value): value is string => Boolean(value)))];
  const dedupeKeys = [...new Set(items.map(dedupeKey))];
  const rows = new Map<string, ExistingStageRow>();
  const byKey = new Map<string, ExistingStageRow>();

  if (externalIds.length) {
    const response = await db
      .from("avdb_stage_items")
      .select("id,external_id,dedupe_key,stage_status,player_status")
      .eq("source", "avdbapi")
      .in("external_id", externalIds);
    if (response.error) throw new Error(response.error.message);
    for (const row of (response.data || []) as ExistingStageRow[]) {
      if (row.external_id) rows.set(row.external_id, row);
      if (row.dedupe_key && !byKey.has(row.dedupe_key)) byKey.set(row.dedupe_key, row);
    }
  }

  if (dedupeKeys.length) {
    const response = await db
      .from("avdb_stage_items")
      .select("id,external_id,dedupe_key,stage_status,player_status")
      .eq("source", "avdbapi")
      .in("dedupe_key", dedupeKeys)
      .limit(500);
    if (response.error) throw new Error(response.error.message);
    for (const row of (response.data || []) as ExistingStageRow[]) {
      if (row.external_id && !rows.has(row.external_id)) rows.set(row.external_id, row);
      if (row.dedupe_key && !byKey.has(row.dedupe_key)) byKey.set(row.dedupe_key, row);
    }
  }

  return { byExternalId: rows, byKey };
}

function stagePayload(run: RunRow, pageNumber: number, pageUrl: string, item: AvdbScanItem) {
  const externalId = clean(item.id);
  const key = dedupeKey(item);
  return {
    run_id: run.id,
    source: "avdbapi",
    source_page: pageNumber,
    source_page_url: pageUrl,
    api_url: item.apiUrl,
    external_id: externalId,
    movie_code: clean(item.movieCode),
    title: item.name || item.movieCode || item.slug || "",
    original_title: clean(item.originalName),
    slug: clean(item.slug),
    year: clean(item.year),
    quality: clean(item.quality),
    duration: clean(item.duration),
    description: clean(item.description),
    poster_url: clean(item.posterUrl),
    thumb_url: clean(item.thumbUrl),
    player_page_url: clean(item.playerUrl),
    player_provider: clean(item.playerProvider),
    dedupe_key: key,
    raw_data: item.rawData || {},
    updated_at: nowIso(),
  };
}

async function updateExistingRows(
  db: SupabaseClient,
  rows: Array<{ existing: ExistingStageRow; payload: ReturnType<typeof stagePayload> }>,
) {
  let updated = 0;
  const chunkSize = 5;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const results = await Promise.all(
      chunk.map(({ existing, payload }) => {
        const keepStage = ["duplicate", "player_check", "player_ready", "published"].includes(existing.stage_status)
          ? existing.stage_status
          : "staged";
        return db
          .from("avdb_stage_items")
          .update({ ...payload, stage_status: keepStage })
          .eq("id", existing.id);
      }),
    );
    for (const result of results) {
      if (result.error) throw new Error(result.error.message);
      updated += 1;
    }
  }
  return updated;
}

async function stageScanItems(db: SupabaseClient, run: RunRow, pageNumber: number, pageUrl: string, items: AvdbScanItem[]) {
  if (!items.length) return { inserted: 0, updated: 0, duplicates: 0, newStaged: 0 };

  const existing = await loadExistingRows(db, items);
  const updates: Array<{ existing: ExistingStageRow; payload: ReturnType<typeof stagePayload> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const seenNewKeys = new Set<string>();
  const seenNewExternalIds = new Set<string>();
  let duplicates = 0;
  let newStaged = 0;

  for (const item of items) {
    const payload = stagePayload(run, pageNumber, pageUrl, item);
    const externalId = payload.external_id;
    const exact = externalId ? existing.byExternalId.get(externalId) : undefined;
    if (exact) {
      updates.push({ existing: exact, payload });
      continue;
    }

    if (externalId && seenNewExternalIds.has(externalId)) {
      duplicates += 1;
      continue;
    }

    const duplicate = existing.byKey.get(payload.dedupe_key) || (seenNewKeys.has(payload.dedupe_key) ? null : undefined);
    const intraPageDuplicate = seenNewKeys.has(payload.dedupe_key);
    if (duplicate || intraPageDuplicate) {
      duplicates += 1;
      inserts.push({
        ...payload,
        stage_status: "duplicate",
        duplicate_of: duplicate?.id || null,
        player_status: "unverified",
      });
    } else {
      newStaged += 1;
      inserts.push({
        ...payload,
        stage_status: "staged",
        duplicate_of: null,
        player_status: "unverified",
      });
      seenNewKeys.add(payload.dedupe_key);
    }

    if (externalId) seenNewExternalIds.add(externalId);
  }

  const updated = await updateExistingRows(db, updates);
  if (inserts.length) {
    const response = await db.from("avdb_stage_items").insert(inserts);
    if (response.error) throw new Error(response.error.message);
  }

  return { inserted: inserts.length, updated, duplicates, newStaged };
}

async function pauseAfterFailure(db: SupabaseClient, run: RunRow, pageNumber: number, pageUrl: string, error: string) {
  const updatedAt = nowIso();
  const response = await db
    .from("avdb_stage_runs")
    .update({
      status: "paused",
      current_page: pageNumber,
      failed_count: run.failed_count + 1,
      last_error: error,
      paused_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq("id", run.id)
    .select("*")
    .single();
  if (response.error) throw new Error(response.error.message);
  await addLog(db, run.id, "error", "crawler", `หน้า ${pageNumber} ล้มเหลวหลัง Retry ครบ ระบบ Pause ไว้ที่หน้าเดิม`, {
    pageNumber,
    pageUrl,
    error,
  });
  return response.data as RunRow;
}

async function executeStep(runId: string): Promise<AvdbWorkerResult> {
  const db = getDb();
  let run = await fetchRun(db, runId);

  if (run.status === "paused") {
    return {
      ok: true,
      runId,
      status: run.status,
      pageNumber: run.current_page,
      pageUrl: buildAvdbApiPageUrl(run.current_page),
      itemsFound: 0,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      elapsedMs: 0,
      continue: false,
      message: "Run ถูก Pause อยู่",
    };
  }
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return {
      ok: true,
      runId,
      status: run.status,
      pageNumber: run.current_page,
      pageUrl: buildAvdbApiPageUrl(run.current_page),
      itemsFound: 0,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      elapsedMs: 0,
      continue: false,
      message: `Run อยู่สถานะ ${run.status}`,
    };
  }

  run = await markRunning(db, run);
  if (run.status !== "running") throw new Error(`Worker ไม่สามารถ claim run ได้ (${run.status})`);

  const pageNumber = Math.max(run.start_page, Math.min(run.end_page, run.current_page));
  const pageUrl = buildAvdbApiPageUrl(pageNumber);
  const started = Date.now();
  let result: AvdbScanResult | null = null;
  let lastError = "AVDB API scan failed";

  for (let attempt = 0; attempt <= run.retry_limit; attempt += 1) {
    result = await scanAvdbApiPage(pageNumber);
    if (result.ok && (result.items?.length || 0) > 0) break;

    lastError = result.error || `API หน้า ${pageNumber} ไม่พบรายการ JSON ที่อ่านได้`;
    if (attempt < run.retry_limit) {
      await addLog(db, run.id, "warn", "crawler", `API หน้า ${pageNumber} ไม่ผ่าน — Retry ${attempt + 1}/${run.retry_limit}`, {
        pageNumber,
        error: lastError,
      });
    }
  }

  if (!result?.ok || !(result.items?.length || 0)) {
    const paused = await pauseAfterFailure(db, run, pageNumber, pageUrl, lastError);
    return {
      ok: false,
      runId,
      status: paused.status,
      pageNumber,
      pageUrl,
      itemsFound: result?.items?.length || 0,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      elapsedMs: Date.now() - started,
      continue: false,
      message: lastError,
    };
  }

  const staged = await stageScanItems(db, run, pageNumber, pageUrl, result.items || []);
  const finishedPage = pageNumber >= run.end_page;
  const updatedAt = nowIso();
  const nextPage = finishedPage ? pageNumber : pageNumber + 1;
  const patch = {
    status: finishedPage ? "completed" : "running",
    current_page: nextPage,
    checkpoint_page: pageNumber,
    pages_scanned: run.pages_scanned + 1,
    items_discovered: run.items_discovered + (result.items?.length || 0),
    items_staged: run.items_staged + staged.newStaged,
    duplicates_found: run.duplicates_found + staged.duplicates,
    last_error: null,
    finished_at: finishedPage ? updatedAt : null,
    metadata: {
      ...(run.metadata || {}),
      crawler_connected: true,
      source_mode: "avdb-rest-api-pagination",
      last_page_url: pageUrl,
      last_page_elapsed_ms: result.elapsedMs || Date.now() - started,
      last_api_links_found: result.apiLinksFound || 0,
      last_items_found: result.itemsFound || 0,
    },
    updated_at: updatedAt,
  };

  const updateResponse = await db.from("avdb_stage_runs").update(patch).eq("id", run.id).select("*").single();
  if (updateResponse.error) throw new Error(updateResponse.error.message);
  const updatedRun = updateResponse.data as RunRow;

  await addLog(
    db,
    run.id,
    "success",
    "crawler",
    `API หน้า ${pageNumber} เสร็จ: พบ ${result.itemsFound || 0} · ใหม่ ${staged.inserted} · อัปเดต ${staged.updated} · ซ้ำ ${staged.duplicates}`,
    {
      pageNumber,
      pageUrl,
      itemsFound: result.itemsFound || 0,
      inserted: staged.inserted,
      updated: staged.updated,
      duplicates: staged.duplicates,
      elapsedMs: result.elapsedMs || Date.now() - started,
      sourceMode: "rest-api-pagination",
    },
  );

  if (finishedPage) {
    await addLog(db, run.id, "success", "crawler", `Run เสร็จครบ API หน้า ${run.start_page}-${run.end_page}`, {
      pagesScanned: updatedRun.pages_scanned,
      itemsDiscovered: updatedRun.items_discovered,
    });
  }

  return {
    ok: true,
    runId,
    status: updatedRun.status,
    pageNumber,
    pageUrl,
    itemsFound: result.itemsFound || result.items?.length || 0,
    inserted: staged.inserted,
    updated: staged.updated,
    duplicates: staged.duplicates,
    elapsedMs: Date.now() - started,
    continue: updatedRun.status === "running",
    message: finishedPage ? "Run เสร็จครบช่วง API หน้าแล้ว" : `พร้อมทำ API หน้าถัดไป ${nextPage}`,
  };
}

export function runAvdbCrawlerStep(runIdRaw: unknown) {
  const runId = String(runIdRaw || "").trim();
  if (!runId) return Promise.reject(new Error("ไม่พบ runId"));

  const task = serialQueue.then(() => executeStep(runId));
  serialQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
