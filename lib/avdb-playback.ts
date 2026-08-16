import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AvdbPublicDetail = {
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

export type AvdbPlaybackSource = {
  catalogId: string;
  stageItemId: string;
  playerPageUrl: string;
  playerProvider: string | null;
};

type CatalogPlaybackRow = AvdbPublicDetail & {
  source: string;
  is_active: boolean;
  player_page_url: string | null;
};

type StagePlaybackRow = {
  id: string;
  source: string;
  player_page_url: string | null;
  player_provider: string | null;
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

function cleanId(value: unknown) {
  return String(value ?? "").trim().slice(0, 80);
}

const PUBLIC_FIELDS =
  "id,stage_item_id,external_id,movie_code,title,original_title,slug,year,quality,duration,description,poster_url,thumb_url,player_provider,published_at";

export async function fetchAvdbPublicDetail(idValue: unknown) {
  const id = cleanId(idValue);
  if (!id) return null;

  const response = await db()
    .from("avdb_catalog_items")
    .select(PUBLIC_FIELDS)
    .eq("id", id)
    .eq("source", "avdbapi")
    .eq("is_active", true)
    .maybeSingle();

  if (response.error) throw new Error(response.error.message);
  return (response.data || null) as AvdbPublicDetail | null;
}

export async function fetchAvdbPlaybackSource(idValue: unknown): Promise<AvdbPlaybackSource> {
  const id = cleanId(idValue);
  if (!id) throw new Error("ไม่พบรหัส AVDB");

  // AVDB follows the same playback principle as MISSAV: the public catalog
  // stores metadata + the source page reference. A fresh Browser Session is
  // created when the user watches; a previously verified/signed HLS URL is not
  // required because it may already be stale by playback time.
  const catalogResponse = await db()
    .from("avdb_catalog_items")
    .select(`${PUBLIC_FIELDS},source,is_active,player_page_url`)
    .eq("id", id)
    .eq("source", "avdbapi")
    .eq("is_active", true)
    .maybeSingle();

  if (catalogResponse.error) throw new Error(catalogResponse.error.message);
  if (!catalogResponse.data) throw new Error("รายการนี้ไม่ได้อยู่ใน AVDB Public Catalog");

  const catalog = catalogResponse.data as CatalogPlaybackRow;
  const stageResponse = await db()
    .from("avdb_stage_items")
    .select("id,source,player_page_url,player_provider,player_status,stage_status")
    .eq("id", catalog.stage_item_id)
    .eq("source", "avdbapi")
    .maybeSingle();

  if (stageResponse.error) throw new Error(stageResponse.error.message);
  if (!stageResponse.data) throw new Error("ไม่พบข้อมูล Staging ของรายการนี้");

  const stage = stageResponse.data as StagePlaybackRow;
  if (stage.stage_status === "duplicate" || stage.stage_status === "rejected") {
    throw new Error("รายการนี้ไม่พร้อมเป็นต้นทางสำหรับ Playback");
  }

  const playerPageUrl = String(stage.player_page_url || catalog.player_page_url || "").trim();
  if (!playerPageUrl) throw new Error("รายการนี้ไม่มี Player source ที่พร้อมใช้งาน");

  return {
    catalogId: catalog.id,
    stageItemId: stage.id,
    playerPageUrl,
    playerProvider: stage.player_provider || catalog.player_provider || null,
  };
}
