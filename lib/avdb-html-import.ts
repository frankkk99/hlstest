import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const AVDB_DETAIL_API = "https://avdbapi.com/api.php/provide/vod";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const MAX_IDS_PER_REQUEST = 12;
const API_CONCURRENCY = 3;

type DetailItem = {
  id: string;
  apiUrl: string;
  name: string;
  originalName: string;
  slug: string;
  movieCode: string;
  year: string;
  quality: string;
  duration: string;
  description: string;
  posterUrl: string;
  thumbUrl: string;
  playerUrl: string | null;
  playerProvider: string | null;
  rawData: Record<string, unknown>;
};

type ExistingRow = {
  id: string;
  external_id: string | null;
  dedupe_key: string | null;
  stage_status: string;
  player_status: string;
};

let client: SupabaseClient | null | undefined;
let importQueue = Promise.resolve();

function getDb() {
  const url = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");
  client ??= createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
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

function dedupeKey(item: DetailItem) {
  const code = normalizeKey(item.movieCode);
  if (code) return `code:${code}`;
  const slug = normalizeKey(item.slug);
  if (slug) return `slug:${slug}`;
  const title = normalizeKey(item.name);
  if (title) return `title:${title}`;
  return `api:${item.apiUrl}`;
}

function getPlayerUrl(item: any): string | null {
  const serverData = item?.episodes?.server_data;
  if (!serverData || typeof serverData !== "object") return null;
  const full = serverData.Full || serverData.full;
  if (full?.link_embed && typeof full.link_embed === "string") return full.link_embed;
  for (const value of Object.values(serverData) as any[]) {
    if (value?.link_embed && typeof value.link_embed === "string") return value.link_embed;
  }
  return null;
}

function providerFromUrl(raw: string | null) {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeApiItem(raw: any, requestedId: string, apiUrl: string): DetailItem | null {
  const rows = Array.isArray(raw?.list) ? raw.list : raw && typeof raw === "object" ? [raw] : [];
  const item = rows.find((row: any) => String(row?.id ?? "") === requestedId) || rows[0];
  if (!item) return null;
  const playerUrl = getPlayerUrl(item);
  return {
    id: String(item.id ?? requestedId),
    apiUrl,
    name: String(item.name ?? ""),
    originalName: String(item.origin_name ?? item.original_name ?? item.original_title ?? ""),
    slug: String(item.slug ?? ""),
    movieCode: String(item.movie_code ?? item.slug ?? ""),
    year: String(item.year ?? ""),
    quality: String(item.quality ?? ""),
    duration: String(item.time ?? item.duration ?? ""),
    description: String(item.description ?? item.content ?? ""),
    posterUrl: String(item.poster_url ?? ""),
    thumbUrl: String(item.thumb_url ?? ""),
    playerUrl,
    playerProvider: providerFromUrl(playerUrl),
    rawData: item && typeof item === "object" ? item as Record<string, unknown> : {},
  };
}

async function fetchDetail(id: string) {
  const apiUrl = `${AVDB_DETAIL_API}?ac=detail&ids=${encodeURIComponent(id)}`;
  let lastError = "AVDB detail API failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json,text/plain,*/*", "User-Agent": UA },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = "API response is not JSON";
        continue;
      }
      const item = normalizeApiItem(data, id, apiUrl);
      if (!item) {
        lastError = "API returned no item";
        continue;
      }
      return { ok: true as const, item };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "AVDB detail API failed";
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false as const, id, apiUrl, error: lastError };
}

async function fetchDetails(ids: string[]) {
  const items: DetailItem[] = [];
  const errors: Array<{ id: string; apiUrl: string; error: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const result = await fetchDetail(id);
      if (result.ok) items.push(result.item);
      else errors.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(API_CONCURRENCY, ids.length) }, worker));
  return { items, errors };
}

async function loadExisting(db: SupabaseClient, items: DetailItem[]) {
  const externalIds = [...new Set(items.map((item) => item.id))];
  const keys = [...new Set(items.map(dedupeKey))];
  const byExternalId = new Map<string, ExistingRow>();
  const byKey = new Map<string, ExistingRow>();

  if (externalIds.length) {
    const response = await db.from("avdb_stage_items")
      .select("id,external_id,dedupe_key,stage_status,player_status")
      .eq("source", "avdbapi").in("external_id", externalIds);
    if (response.error) throw new Error(response.error.message);
    for (const row of (response.data || []) as ExistingRow[]) {
      if (row.external_id) byExternalId.set(row.external_id, row);
      if (row.dedupe_key) byKey.set(row.dedupe_key, row);
    }
  }

  if (keys.length) {
    const response = await db.from("avdb_stage_items")
      .select("id,external_id,dedupe_key,stage_status,player_status")
      .eq("source", "avdbapi").in("dedupe_key", keys).limit(500);
    if (response.error) throw new Error(response.error.message);
    for (const row of (response.data || []) as ExistingRow[]) {
      if (row.external_id && !byExternalId.has(row.external_id)) byExternalId.set(row.external_id, row);
      if (row.dedupe_key && !byKey.has(row.dedupe_key)) byKey.set(row.dedupe_key, row);
    }
  }
  return { byExternalId, byKey };
}

function stagePayload(item: DetailItem, sourceName: string, sourcePage: number | null) {
  return {
    run_id: null,
    source: "avdbapi",
    source_page: sourcePage,
    source_page_url: `manual-html:${sourceName}`,
    api_url: item.apiUrl,
    external_id: item.id,
    movie_code: clean(item.movieCode),
    title: item.name || item.movieCode || item.slug || `AVDB ${item.id}`,
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
    dedupe_key: dedupeKey(item),
    raw_data: item.rawData || {},
    updated_at: new Date().toISOString(),
  };
}

async function stageItems(items: DetailItem[], sourceName: string, sourcePage: number | null) {
  const db = getDb();
  if (!items.length) return { inserted: 0, updated: 0, duplicates: 0 };
  const existing = await loadExisting(db, items);
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ row: ExistingRow; payload: ReturnType<typeof stagePayload> }> = [];
  const seenExternalIds = new Set<string>();
  const seenKeys = new Set<string>();
  let duplicates = 0;

  for (const item of items) {
    const payload = stagePayload(item, sourceName, sourcePage);
    const exact = existing.byExternalId.get(item.id);
    if (exact) {
      updates.push({ row: exact, payload });
      continue;
    }
    if (seenExternalIds.has(item.id)) {
      duplicates += 1;
      continue;
    }
    const key = payload.dedupe_key;
    const keyMatch = existing.byKey.get(key);
    const intraBatchDuplicate = seenKeys.has(key);
    if (keyMatch || intraBatchDuplicate) {
      duplicates += 1;
      inserts.push({ ...payload, stage_status: "duplicate", duplicate_of: keyMatch?.id || null, player_status: "unverified" });
    } else {
      inserts.push({ ...payload, stage_status: "staged", duplicate_of: null, player_status: "unverified" });
      seenKeys.add(key);
    }
    seenExternalIds.add(item.id);
  }

  let updated = 0;
  for (const { row, payload } of updates) {
    const keepStage = ["duplicate", "player_check", "player_ready", "published"].includes(row.stage_status) ? row.stage_status : "staged";
    const response = await db.from("avdb_stage_items").update({ ...payload, stage_status: keepStage }).eq("id", row.id);
    if (response.error) throw new Error(response.error.message);
    updated += 1;
  }

  if (inserts.length) {
    const response = await db.from("avdb_stage_items").insert(inserts);
    if (response.error) throw new Error(response.error.message);
  }

  const log = await db.from("avdb_stage_logs").insert({
    run_id: null,
    level: "success",
    step: "html-import",
    message: `นำเข้า ${sourceName}: API ${items.length} · ใหม่ ${inserts.length} · อัปเดต ${updated} · ซ้ำ ${duplicates}`,
    context: { sourceName, sourcePage, items: items.length, inserted: inserts.length, updated, duplicates },
  });
  if (log.error) throw new Error(log.error.message);

  return { inserted: inserts.length, updated, duplicates };
}

async function executeImport(idsRaw: unknown, sourceNameRaw: unknown, sourcePageRaw: unknown) {
  const ids = [...new Set((Array.isArray(idsRaw) ? idsRaw : [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => /^\d{1,12}$/.test(value)))]
    .slice(0, MAX_IDS_PER_REQUEST);
  if (!ids.length) throw new Error("ไม่พบ AVDB ID ที่ถูกต้อง");

  const sourceName = String(sourceNameRaw || "pasted-source").replace(/[\r\n<>]/g, " ").trim().slice(0, 120) || "pasted-source";
  const parsedPage = Number(sourcePageRaw);
  const sourcePage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : null;
  const fetched = await fetchDetails(ids);
  const staged = await stageItems(fetched.items, sourceName, sourcePage);

  return {
    requested: ids.length,
    fetched: fetched.items.length,
    failed: fetched.errors.length,
    ...staged,
    errors: fetched.errors,
    items: fetched.items.map((item) => ({
      id: item.id,
      movieCode: item.movieCode,
      title: item.name,
      quality: item.quality,
      duration: item.duration,
      thumbUrl: item.thumbUrl || item.posterUrl,
      playerProvider: item.playerProvider,
    })),
  };
}

export function importAvdbIdsFromHtml(ids: unknown, sourceName: unknown, sourcePage: unknown) {
  const task = importQueue.then(() => executeImport(ids, sourceName, sourcePage));
  importQueue = task.then(() => undefined, () => undefined);
  return task;
}
