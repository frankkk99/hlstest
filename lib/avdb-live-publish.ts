import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ELIGIBLE_STAGE_STATUSES = ["staged", "player_check", "player_ready"];

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

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function activeCatalogCount(database: SupabaseClient) {
  const response = await database
    .from("avdb_catalog_items")
    .select("id", { count: "exact", head: true })
    .eq("source", "avdbapi")
    .eq("is_active", true);
  if (response.error) throw new Error(response.error.message);
  return response.count || 0;
}

async function eligibleCount(database: SupabaseClient) {
  const response = await database
    .from("avdb_stage_items")
    .select("id", { count: "exact", head: true })
    .eq("source", "avdbapi")
    .in("stage_status", ELIGIBLE_STAGE_STATUSES)
    .not("player_page_url", "is", null);
  if (response.error) throw new Error(response.error.message);
  return response.count || 0;
}

export async function fetchAvdbLivePublishState() {
  const database = db();
  const [readyToPublish, published, recentResponse] = await Promise.all([
    eligibleCount(database),
    activeCatalogCount(database),
    database
      .from("avdb_catalog_items")
      .select("id,stage_item_id,movie_code,title,player_provider,published_at,is_active")
      .eq("source", "avdbapi")
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  if (recentResponse.error) throw new Error(recentResponse.error.message);
  return { readyToPublish, published, recent: recentResponse.data || [] };
}

export async function publishAvdbLiveItems(input: { itemIds?: string[]; limit?: unknown }) {
  const database = db();
  const itemIds = [...new Set((input.itemIds || []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
  const limit = clampInt(input.limit, 1, 100, itemIds.length || 50);

  let query = database
    .from("avdb_stage_items")
    .select(
      "id,run_id,external_id,movie_code,title,original_title,slug,year,quality,duration,description,poster_url,thumb_url,player_page_url,player_provider,verified_media_url,player_diagnostics,dedupe_key,raw_data,player_status,stage_status",
    )
    .eq("source", "avdbapi")
    .in("stage_status", ELIGIBLE_STAGE_STATUSES)
    .not("player_page_url", "is", null)
    .order("first_seen_at", { ascending: true })
    .limit(limit);

  if (itemIds.length) query = query.in("id", itemIds);
  const response = await query;
  if (response.error) throw new Error(response.error.message);
  const rows = response.data || [];
  if (!rows.length) return { published: 0, remaining: await eligibleCount(database) };

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

  const upsert = await database.from("avdb_catalog_items").upsert(payload, { onConflict: "stage_item_id" });
  if (upsert.error) throw new Error(upsert.error.message);

  const ids = rows.map((row) => row.id);
  const stageUpdate = await database
    .from("avdb_stage_items")
    .update({ stage_status: "published", published_at: now, updated_at: now })
    .in("id", ids);
  if (stageUpdate.error) throw new Error(stageUpdate.error.message);

  const runIds = [...new Set(rows.map((row) => String(row.run_id || "")).filter(Boolean))];
  for (const runId of runIds) {
    const count = await database
      .from("avdb_stage_items")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("stage_status", "published");
    if (!count.error) {
      await database
        .from("avdb_stage_runs")
        .update({ published_count: count.count || 0, updated_at: now })
        .eq("id", runId);
    }
  }

  await database.from("avdb_stage_logs").insert({
    run_id: runIds[0] || null,
    level: "success",
    step: "publish",
    message: `Publish AVDB metadata ${rows.length} รายการ; Player จะ resolve สดตอนกดดู`,
    context: { count: rows.length, itemIds: ids, mode: "live-playback" },
  });

  return { published: rows.length, remaining: await eligibleCount(database) };
}
