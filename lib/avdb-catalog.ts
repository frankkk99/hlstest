import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AvdbPublicCatalogItem = {
  id: string;
  stage_item_id: string;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  slug: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  description: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_provider: string | null;
  published_at: string;
};

type StagePublishRow = {
  id: string;
  run_id: string | null;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  slug: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  description: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_page_url: string | null;
  player_provider: string | null;
  verified_media_url: string | null;
  player_diagnostics: Record<string, unknown> | null;
  dedupe_key: string | null;
  raw_data: Record<string, unknown> | null;
  player_status: string;
  stage_status: string;
};

let client: SupabaseClient | null | undefined;

function config() {
  return {
    url:
      process.env.HLSHUB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function db() {
  const value = config();
  if (!value.key) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");
  client ??= createClient(value.url, value.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

function cleanSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[%,()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function countCatalogRows(database: SupabaseClient, activeOnly = true) {
  let query = database.from("avdb_catalog_items").select("id", { count: "exact", head: true });
  if (activeOnly) query = query.eq("is_active", true);
  const response = await query;
  if (response.error) throw new Error(response.error.message);
  return response.count || 0;
}

async function addPublishLog(
  database: SupabaseClient,
  runId: string | null,
  level: "info" | "warn" | "success" | "error",
  message: string,
  context: Record<string, unknown> = {},
) {
  const response = await database.from("avdb_stage_logs").insert({
    run_id: runId,
    level,
    step: "publish",
    message,
    context,
  });
  if (response.error) throw new Error(response.error.message);
}

export async function fetchAvdbPublicCatalog(input: {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
}) {
  const database = db();
  const page = clampInt(input.page, 1, 100000, 1);
  const limit = clampInt(input.limit, 1, 48, 24);
  const search = cleanSearch(input.search);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = database
    .from("avdb_catalog_items")
    .select(
      "id,stage_item_id,external_id,movie_code,title,original_title,slug,year,quality,duration,description,poster_url,thumb_url,player_provider,published_at",
      { count: "exact" },
    )
    .eq("source", "avdbapi")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`movie_code.ilike.%${search}%,title.ilike.%${search}%,original_title.ilike.%${search}%`);
  }

  const response = await query;
  if (response.error) throw new Error(response.error.message);
  const total = response.count || 0;

  return {
    page,
    limit,
    search,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    items: (response.data || []) as AvdbPublicCatalogItem[],
  };
}

export async function fetchAvdbPublishState() {
  const database = db();
  const [readyResponse, catalogCount, recentResponse] = await Promise.all([
    database
      .from("avdb_stage_items")
      .select("id", { count: "exact", head: true })
      .eq("source", "avdbapi")
      .eq("player_status", "ready")
      .eq("stage_status", "player_ready"),
    countCatalogRows(database, true),
    database
      .from("avdb_catalog_items")
      .select("id,stage_item_id,movie_code,title,player_provider,published_at,is_active")
      .eq("source", "avdbapi")
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  if (readyResponse.error) throw new Error(readyResponse.error.message);
  if (recentResponse.error) throw new Error(recentResponse.error.message);

  return {
    readyToPublish: readyResponse.count || 0,
    published: catalogCount,
    recent: recentResponse.data || [],
  };
}

async function refreshRunPublishedCounts(database: SupabaseClient, runIds: string[]) {
  for (const runId of [...new Set(runIds.filter(Boolean))]) {
    const countResponse = await database
      .from("avdb_stage_items")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("stage_status", "published");
    if (countResponse.error) throw new Error(countResponse.error.message);
    const updateResponse = await database
      .from("avdb_stage_runs")
      .update({ published_count: countResponse.count || 0, updated_at: new Date().toISOString() })
      .eq("id", runId);
    if (updateResponse.error) throw new Error(updateResponse.error.message);
  }
}

export async function publishAvdbReadyItems(input: { itemIds?: string[]; limit?: unknown }) {
  const database = db();
  const limit = clampInt(input.limit, 1, 100, input.itemIds?.length || 50);
  const itemIds = [...new Set((input.itemIds || []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);

  let query = database
    .from("avdb_stage_items")
    .select(
      "id,run_id,external_id,movie_code,title,original_title,slug,year,quality,duration,description,poster_url,thumb_url,player_page_url,player_provider,verified_media_url,player_diagnostics,dedupe_key,raw_data,player_status,stage_status",
    )
    .eq("source", "avdbapi")
    .eq("player_status", "ready")
    .eq("stage_status", "player_ready")
    .not("player_page_url", "is", null)
    .not("verified_media_url", "is", null)
    .order("player_checked_at", { ascending: true })
    .limit(limit);

  if (itemIds.length) query = query.in("id", itemIds);

  const response = await query;
  if (response.error) throw new Error(response.error.message);
  const rows = (response.data || []) as StagePublishRow[];
  if (!rows.length) return { published: 0, remaining: (await fetchAvdbPublishState()).readyToPublish };

  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    stage_item_id: row.id,
    source: "avdbapi",
    external_id: row.external_id,
    movie_code: row.movie_code,
    title: row.title,
    original_title: row.original_title,
    slug: row.slug,
    year: row.year,
    quality: row.quality,
    duration: row.duration,
    description: row.description,
    poster_url: row.poster_url,
    thumb_url: row.thumb_url,
    player_page_url: row.player_page_url,
    player_provider: row.player_provider,
    verified_media_url: row.verified_media_url,
    player_diagnostics: row.player_diagnostics || {},
    dedupe_key: row.dedupe_key,
    raw_data: row.raw_data || {},
    is_active: true,
    published_at: now,
    updated_at: now,
  }));

  const upsertResponse = await database
    .from("avdb_catalog_items")
    .upsert(payload, { onConflict: "stage_item_id" });
  if (upsertResponse.error) throw new Error(upsertResponse.error.message);

  const ids = rows.map((row) => row.id);
  const stageResponse = await database
    .from("avdb_stage_items")
    .update({ stage_status: "published", published_at: now, last_error: null, updated_at: now })
    .in("id", ids);
  if (stageResponse.error) throw new Error(stageResponse.error.message);

  const runIds = rows.map((row) => row.run_id).filter((value): value is string => Boolean(value));
  await refreshRunPublishedCounts(database, runIds);
  await addPublishLog(database, runIds[0] || null, "success", `Publish AVDB ${rows.length} รายการเข้า Public Catalog`, {
    count: rows.length,
    itemIds: ids,
  });

  return { published: rows.length, remaining: (await fetchAvdbPublishState()).readyToPublish };
}

export async function unpublishAvdbCatalogItem(input: { catalogId?: unknown; stageItemId?: unknown }) {
  const database = db();
  const catalogId = String(input.catalogId || "").trim();
  const stageItemId = String(input.stageItemId || "").trim();
  if (!catalogId && !stageItemId) throw new Error("ไม่พบ catalogId หรือ stageItemId");

  let lookup = database
    .from("avdb_catalog_items")
    .select("id,stage_item_id,movie_code,title,is_active")
    .eq("source", "avdbapi");
  lookup = catalogId ? lookup.eq("id", catalogId) : lookup.eq("stage_item_id", stageItemId);
  const existingResponse = await lookup.maybeSingle();
  if (existingResponse.error) throw new Error(existingResponse.error.message);
  if (!existingResponse.data) throw new Error("ไม่พบรายการ AVDB ใน Public Catalog");

  const now = new Date().toISOString();
  const catalogResponse = await database
    .from("avdb_catalog_items")
    .update({ is_active: false, updated_at: now })
    .eq("id", existingResponse.data.id);
  if (catalogResponse.error) throw new Error(catalogResponse.error.message);

  const stageResponse = await database
    .from("avdb_stage_items")
    .update({ stage_status: "player_ready", published_at: null, updated_at: now })
    .eq("id", existingResponse.data.stage_item_id)
    .eq("player_status", "ready");
  if (stageResponse.error) throw new Error(stageResponse.error.message);

  await addPublishLog(database, null, "warn", `Unpublish ${existingResponse.data.movie_code || existingResponse.data.title}`, {
    catalogId: existingResponse.data.id,
    stageItemId: existingResponse.data.stage_item_id,
  });

  return { ok: true, catalogId: existingResponse.data.id, stageItemId: existingResponse.data.stage_item_id };
}
