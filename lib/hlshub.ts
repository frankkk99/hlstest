import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type HlshubPerson = {
  name: string;
  profileUrl?: string | null;
  role: "actor" | "actress" | "director" | "writer" | "producer" | "maker" | "other";
};

export type HlshubTerm = {
  name: string;
  url?: string | null;
  type: "genre" | "category" | "maker" | "label" | "series" | "tag" | "language" | "other";
};

export type HlshubPageMetadata = {
  canonicalUrl: string;
  locale: string | null;
  slug: string;
  code: string | null;
  title: string | null;
  originalTitle: string | null;
  synopsis: string | null;
  releaseDate: string | null;
  durationSeconds: number | null;
  isSeries: boolean;
  imageUrls: string[];
  people: HlshubPerson[];
  terms: HlshubTerm[];
  raw: Record<string, unknown>;
};

export type HlshubPlayerResult = {
  ok: boolean;
  status: number;
  sourceStatus: number;
  mediaUrl: string | null;
  contentType: string | null;
  elapsedMs: number;
  error?: string;
  pageMetadata?: HlshubPageMetadata | null;
};

export type HlshubDiscoveredItem = {
  url: string;
  label: string;
};

let client: SupabaseClient | null | undefined;

function getConfig() {
  return {
    url: process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

export function isHlshubConfigured() {
  return Boolean(getConfig().key);
}

function getClient() {
  const config = getConfig();
  if (!config.key) return null;
  client ??= createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

function sourceSlug(url: string) {
  return new URL(url).pathname.split("/").filter(Boolean).pop() || url;
}

function normalizeTermSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9ก-๙]+/gi, "-").replace(/^-+|-+$/g, "");
}

function discoveryMetadata(item: HlshubDiscoveredItem): HlshubPageMetadata {
  const url = new URL(item.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || sourceSlug(item.url);
  const locale = parts.find((part) => /^(?:th|en|ja|ko|cn|ms|de|fr|vi|id|fil|pt)$/i.test(part))?.toLowerCase() || null;
  const label = item.label.trim() || slug.replace(/[-_]+/g, " ");

  return {
    canonicalUrl: item.url,
    locale,
    slug,
    code: slug || null,
    title: label,
    originalTitle: null,
    synopsis: null,
    releaseDate: null,
    durationSeconds: null,
    isSeries: false,
    imageUrls: [],
    people: [],
    terms: [],
    raw: { capturedBy: "bulk-discover", label: item.label, discoveredAt: new Date().toISOString() },
  };
}

export async function saveHlshubDiscoveredBatch(items: HlshubDiscoveredItem[]) {
  const supabase = getClient();
  if (!supabase) return { configured: false, savedCount: 0, error: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" };
  if (!items.length) return { configured: true, savedCount: 0, error: null };

  const db = supabase.schema("hlshub");
  const siteResponse = await db.from("source_sites").select("id").eq("site_key", "missav123").maybeSingle();
  if (siteResponse.error || !siteResponse.data) {
    return { configured: true, savedCount: 0, error: siteResponse.error?.message || "ไม่พบ source site" };
  }

  const sourceSiteId = siteResponse.data.id;
  const now = new Date().toISOString();
  const rows = items.map((item) => {
    const metadata = discoveryMetadata(item);
    return {
      source_site_id: sourceSiteId,
      source_key: metadata.canonicalUrl,
      canonical_url: metadata.canonicalUrl,
      slug: metadata.slug,
      code: metadata.code,
      title: metadata.title,
      original_title: null,
      synopsis: null,
      release_date: null,
      duration_seconds: null,
      language: metadata.locale,
      is_series: false,
      raw_metadata: metadata.raw,
      last_seen_at: now,
    };
  });
  const response = await db.from("titles").upsert(rows, { onConflict: "source_site_id,canonical_url" });
  if (response.error) return { configured: true, savedCount: 0, error: response.error.message };
  return { configured: true, savedCount: rows.length, error: null };
}

export async function saveHlshubResult(result: HlshubPlayerResult) {
  const supabase = getClient();
  if (!supabase) return { saved: false, reason: "ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY" };
  const metadata = result.pageMetadata;
  if (!metadata) return { saved: false, reason: "ไม่มี metadata จากหน้าเรื่อง" };

  const db = supabase.schema("hlshub");
  const siteResponse = await db.from("source_sites").select("id").eq("site_key", "missav123").maybeSingle();
  if (siteResponse.error || !siteResponse.data) {
    return { saved: false, reason: siteResponse.error?.message || "ไม่พบ source site" };
  }

  const titleResponse = await db.from("titles").upsert(
    {
      source_site_id: siteResponse.data.id,
      source_key: metadata.canonicalUrl,
      canonical_url: metadata.canonicalUrl,
      slug: metadata.slug,
      code: metadata.code,
      title: metadata.title,
      original_title: metadata.originalTitle,
      synopsis: metadata.synopsis,
      release_date: metadata.releaseDate,
      duration_seconds: metadata.durationSeconds,
      language: metadata.locale,
      is_series: metadata.isSeries,
      raw_metadata: metadata.raw,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "source_site_id,canonical_url" },
  ).select("id").single();

  if (titleResponse.error || !titleResponse.data) {
    return { saved: false, reason: titleResponse.error?.message || "บันทึก title ไม่สำเร็จ" };
  }
  const titleId = titleResponse.data.id;

  if (metadata.locale && (metadata.title || metadata.originalTitle || metadata.synopsis)) {
    await db.from("title_localizations").upsert(
      {
        title_id: titleId,
        locale: metadata.locale,
        title: metadata.title,
        original_title: metadata.originalTitle,
        synopsis: metadata.synopsis,
        raw_metadata: metadata.raw,
      },
      { onConflict: "title_id,locale" },
    );
  }

  if (metadata.imageUrls.length) {
    await db.from("media_assets").upsert(
      metadata.imageUrls.map((url, index) => ({
        title_id: titleId,
        kind: index === 0 ? "cover" : "other",
        url,
        sort_order: index,
        metadata: { source: "detail-page" },
      })),
      { onConflict: "title_id,kind,url" },
    );
  }

  for (const person of metadata.people) {
    const personResponse = await db.from("people").upsert(
      {
        source_site_id: siteResponse.data.id,
        canonical_name: person.name,
        profile_url: person.profileUrl,
      },
      { onConflict: "source_site_id,canonical_name" },
    ).select("id").single();
    if (personResponse.data) {
      await db.from("title_people").upsert(
        {
          title_id: titleId,
          person_id: personResponse.data.id,
          role: person.role,
        },
        { onConflict: "title_id,person_id,role" },
      );
    }
  }

  for (const term of metadata.terms) {
    const termResponse = await db.from("taxonomy_terms").upsert(
      {
        source_site_id: siteResponse.data.id,
        term_type: term.type,
        name: term.name,
        slug: normalizeTermSlug(term.name),
        raw_metadata: { url: term.url },
      },
      { onConflict: "source_site_id,term_type,name" },
    ).select("id").single();
    if (termResponse.data) {
      await db.from("title_terms").upsert(
        { title_id: titleId, term_id: termResponse.data.id, source_label: term.name },
        { onConflict: "title_id,term_id" },
      );
    }
  }

  if (result.mediaUrl) {
    const existingSource = await db.from("player_sources")
      .select("id")
      .eq("title_id", titleId)
      .is("episode_id", null)
      .eq("media_url", result.mediaUrl)
      .maybeSingle();

    const sourcePayload = {
      title_id: titleId,
      source_type: /\.mp4(?:$|\?)/i.test(result.mediaUrl) ? "mp4" : "hls",
      provider: new URL(result.mediaUrl).hostname,
      player_page_url: metadata.canonicalUrl,
      media_url: result.mediaUrl,
      origin: new URL(metadata.canonicalUrl).origin,
      referer: metadata.canonicalUrl,
      is_primary: true,
      status: result.ok ? "pass" : result.status === 403 ? "blocked" : "error",
      last_seen_at: new Date().toISOString(),
      raw_metadata: { contentType: result.contentType, page: metadata.raw },
    };

    let playerSourceId = existingSource.data?.id;
    if (playerSourceId) {
      await db.from("player_sources").update(sourcePayload).eq("id", playerSourceId);
    } else {
      const insertedSource = await db.from("player_sources").insert(sourcePayload).select("id").single();
      playerSourceId = insertedSource.data?.id;
    }

    if (playerSourceId) {
      await db.from("player_tests").insert({
        player_source_id: playerSourceId,
        status: result.ok ? "pass" : result.status === 403 ? "blocked" : "error",
        http_status: result.status || result.sourceStatus,
        content_type: result.contentType,
        error_message: result.error,
        diagnostics: { elapsedMs: result.elapsedMs, sourceStatus: result.sourceStatus },
      });
    }
  }

  await db.from("raw_documents").insert({
    title_id: titleId,
    url: metadata.canonicalUrl,
    final_url: metadata.canonicalUrl,
    content_type: "text/html",
    http_status: result.sourceStatus,
    body_json: metadata.raw,
    metadata: { capturedBy: "chromium", mediaUrl: result.mediaUrl },
  });

  return { saved: true, titleId };
}
