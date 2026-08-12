import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicCuratedOrder } from "@/lib/curated-catalog";

export type CatalogItem = {
  id: number;
  canonicalUrl: string;
  code: string | null;
  slug: string | null;
  title: string | null;
  originalTitle: string | null;
  synopsis: string | null;
  releaseDate: string | null;
  durationSeconds: number | null;
  language: string | null;
  isSeries: boolean;
  lastSeenAt: string | null;
  coverUrl: string | null;
  playerStatus: "pass" | "blocked" | "error" | "expired" | "unknown" | null;
  playerType: "hls" | "mp4" | "embed" | "unknown" | null;
  playerPageUrl: string | null;
  mediaUrl: string | null;
  origin: string | null;
  referer: string | null;
  provider: string | null;
  isActive: boolean;
  hasPlayer: boolean;
  sourceCount: number;
};

export type CatalogDetail = CatalogItem & {
  images: Array<{ kind: string; url: string; sortOrder: number }>;
  localizations: Array<{
    locale: string;
    title: string | null;
    originalTitle: string | null;
    synopsis: string | null;
  }>;
  people: Array<{ name: string; role: string; profileUrl: string | null }>;
  terms: Array<{ name: string; type: string; url: string | null }>;
};

export type AdminCatalogFilter = "all" | "ready" | "no-player" | "broken" | "unknown";

export type AdminCatalogOverview = {
  configured: boolean;
  activeTitles: number;
  hiddenTitles: number;
  readyTitles: number;
  noPlayerTitles: number;
  brokenTitles: number;
  unknownTitles: number;
  movieTitles: number;
  seriesTitles: number;
  sourceCount: number;
  sourceStatus: Record<SourceRow["status"], number>;
  lastCheckedAt: string;
};

type TitleRow = {
  id: number;
  canonical_url: string;
  code: string | null;
  slug: string | null;
  title: string | null;
  original_title: string | null;
  synopsis: string | null;
  release_date: string | null;
  duration_seconds: number | null;
  language: string | null;
  is_series: boolean;
  last_seen_at: string | null;
  is_active: boolean;
};

type AssetRow = {
  title_id: number;
  kind: string;
  url: string;
  sort_order: number;
};

type SourceRow = {
  id: number;
  title_id: number;
  source_type: "hls" | "mp4" | "embed" | "unknown";
  provider: string | null;
  player_page_url: string | null;
  media_url: string | null;
  origin: string | null;
  referer: string | null;
  is_primary: boolean;
  status: "pass" | "blocked" | "error" | "expired" | "unknown";
  last_seen_at: string | null;
};

let client: SupabaseClient | null | undefined;
type CatalogDb = ReturnType<SupabaseClient["schema"]>;

function getConfig() {
  return {
    url:
      process.env.HLSHUB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

export function isCatalogConfigured() {
  return Boolean(getConfig().key);
}

export function getCatalogDb() {
  const config = getConfig();
  if (!config.key) return null;
  client ??= createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.schema("hlshub");
}

function chooseSource(sources: SourceRow[]) {
  return [...sources].sort((left, right) => {
    // A stale primary source must not hide a healthy backup source.
    const statusRank = (status: SourceRow["status"]) => {
      if (status === "pass") return 0;
      if (status === "unknown") return 1;
      if (status === "expired") return 2;
      if (status === "error") return 3;
      return 4;
    };
    const rankDifference = statusRank(left.status) - statusRank(right.status);
    if (rankDifference !== 0) return rankDifference;
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return (right.last_seen_at || "").localeCompare(left.last_seen_at || "");
  })[0] || null;
}

function isPlayableSource(source: SourceRow) {
  // The public watch page needs a passed source and the original player page
  // to create a fresh browser session. A database row by itself is not enough.
  return source.status === "pass" && Boolean(source.player_page_url);
}

async function fetchPlayableTitleIds(db: CatalogDb) {
  const ids = new Set<number>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const response = await db
      .from("player_sources")
      .select("title_id")
      .eq("status", "pass")
      .not("player_page_url", "is", null)
      .is("episode_id", null)
      .range(from, from + pageSize - 1);

    if (response.error) throw new Error(response.error.message);
    const rows = (response.data || []) as Array<{ title_id: number }>;
    rows.forEach((row) => ids.add(Number(row.title_id)));
    if (rows.length < pageSize) break;
  }

  return [...ids].filter(Number.isSafeInteger);
}

async function fetchAllTitleLevelSources(db: CatalogDb) {
  const rows: SourceRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const response = await db
      .from("player_sources")
      .select("id,title_id,source_type,provider,player_page_url,media_url,origin,referer,is_primary,status,last_seen_at")
      .is("episode_id", null)
      .range(from, from + pageSize - 1);

    if (response.error) throw new Error(response.error.message);
    const page = (response.data || []) as SourceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function titleIdsForFilter(titleIds: number[], sources: SourceRow[], filter: AdminCatalogFilter) {
  if (filter === "all") return null;

  const byTitle = new Map<number, SourceRow[]>();
  for (const source of sources) {
    const current = byTitle.get(Number(source.title_id)) || [];
    current.push(source);
    byTitle.set(Number(source.title_id), current);
  }

  return titleIds.filter((id) => {
    const titleSources = byTitle.get(id) || [];
    const ready = titleSources.some(isPlayableSource);
    if (filter === "ready") return ready;
    if (filter === "no-player") return !ready;
    if (filter === "unknown") return !ready && titleSources.some((source) => source.status === "unknown");
    return !ready && titleSources.some((source) => ["blocked", "error", "expired"].includes(source.status));
  });
}

async function fetchCatalogItemsForTitles(
  db: CatalogDb,
  titles: TitleRow[],
): Promise<CatalogItem[]> {
  const ids = titles.map((title) => title.id);
  if (!ids.length) return [];

  const [assetsResponse, sourcesResponse] = await Promise.all([
    db.from("media_assets").select("title_id,kind,url,sort_order").in("title_id", ids).order("sort_order"),
    db
      .from("player_sources")
      .select("id,title_id,source_type,provider,player_page_url,media_url,origin,referer,is_primary,status,last_seen_at")
      .in("title_id", ids)
      .is("episode_id", null)
      .order("is_primary", { ascending: false }),
  ]);

  if (assetsResponse.error) throw new Error(assetsResponse.error.message);
  if (sourcesResponse.error) throw new Error(sourcesResponse.error.message);

  const assets = (assetsResponse.data || []) as AssetRow[];
  const sources = (sourcesResponse.data || []) as SourceRow[];
  return titles.map((title) =>
    toCatalogItem(
      title,
      assets.filter((asset) => String(asset.title_id) === String(title.id)),
      sources.filter((source) => String(source.title_id) === String(title.id)),
    ),
  );
}

function fallbackCoverUrl(title: TitleRow) {
  const slug = (title.slug || title.code || "").trim();
  if (!slug || slug.toLowerCase() === "articles") return null;
  return `https://fourhoi.com/${encodeURIComponent(slug)}/cover-n.jpg`;
}

export function toCatalogItem(
  title: TitleRow,
  assets: AssetRow[],
  sources: SourceRow[],
): CatalogItem {
  const source = chooseSource(sources);
  const cover = [...assets]
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "cover" ? -1 : 1;
      return left.sort_order - right.sort_order;
    })
    .find((asset) => asset.url);

  return {
    id: title.id,
    canonicalUrl: title.canonical_url,
    code: title.code,
    slug: title.slug,
    title: title.title,
    originalTitle: title.original_title,
    synopsis: title.synopsis,
    releaseDate: title.release_date,
    durationSeconds: title.duration_seconds,
    language: title.language,
    isSeries: title.is_series,
    lastSeenAt: title.last_seen_at,
    coverUrl: cover?.url || fallbackCoverUrl(title),
    playerStatus: source?.status || null,
    playerType: source?.source_type || null,
    playerPageUrl: source?.player_page_url || null,
    mediaUrl: source?.media_url || null,
    origin: source?.origin || null,
    referer: source?.referer || null,
    provider: source?.provider || null,
    isActive: title.is_active,
    // A database row is not proof that the source can play. Only a passed
    // source should be advertised as ready to viewers.
    hasPlayer: sources.some(isPlayableSource),
    sourceCount: sources.length,
  };
}

export async function fetchCatalogPage(options: {
  page: number;
  limit: number;
  search?: string;
  sort?: "latest" | "release" | "title";
  readyOnly?: boolean;
  codes?: readonly string[];
}) {
  const db = getCatalogDb();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const playableTitleIds = options.readyOnly ? await fetchPlayableTitleIds(db) : null;
  if (playableTitleIds && !playableTitleIds.length) {
    return { items: [] as CatalogItem[], total: 0 };
  }

  const from = Math.max(0, (options.page - 1) * options.limit);
  const to = from + options.limit - 1;
  let query = db
    .from("titles")
    .select(
      "id,canonical_url,code,slug,title,original_title,synopsis,release_date,duration_seconds,language,is_series,last_seen_at,is_active",
      { count: "exact" },
    )
    .eq("is_active", true)
    .neq("code", "articles")
    .neq("slug", "articles");

  if (playableTitleIds) query = query.in("id", playableTitleIds);
  if (options.codes?.length) query = query.in("code", [...options.codes]);

  const search = options.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,code.ilike.%${safe}%,original_title.ilike.%${safe}%`);
  }

  if (options.sort === "title") {
    query = query.order("title", { ascending: true, nullsFirst: false });
  } else if (options.sort === "release") {
    query = query.order("release_date", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("last_seen_at", { ascending: false, nullsFirst: false });
  }

  const titleResponse = await query.range(from, to);
  if (titleResponse.error) throw new Error(titleResponse.error.message);

  const titles = (titleResponse.data || []) as TitleRow[];
  const ids = titles.map((title) => title.id);
  if (!ids.length) {
    return { items: [] as CatalogItem[], total: titleResponse.count || 0 };
  }

  const items = await fetchCatalogItemsForTitles(db, titles);
  if (options.codes?.length) items.sort((left, right) => publicCuratedOrder(left.code) - publicCuratedOrder(right.code));

  return {
    items,
    total: titleResponse.count || 0,
  };
}

export async function fetchAdminCatalogPage(options: {
  page: number;
  limit: number;
  search?: string;
  sort?: "latest" | "release" | "title";
  filter?: AdminCatalogFilter;
  active?: "active" | "hidden" | "all";
}) {
  const db = getCatalogDb();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const activeMode = options.active || "active";
  let filterIds: number[] | null = null;
  if (options.filter && options.filter !== "all") {
    let titlesQuery = db
      .from("titles")
      .select("id")
      .neq("code", "articles")
      .neq("slug", "articles");
    if (activeMode !== "all") titlesQuery = titlesQuery.eq("is_active", activeMode === "active");
    const titlesResponse = await titlesQuery.range(0, 9999);
    if (titlesResponse.error) throw new Error(titlesResponse.error.message);
    const titleIds = ((titlesResponse.data || []) as Array<{ id: number }>).map((row) => Number(row.id));
    const sources = await fetchAllTitleLevelSources(db);
    filterIds = titleIdsForFilter(titleIds, sources, options.filter) || [];
    if (!filterIds.length) return { items: [] as CatalogItem[], total: 0 };
  }

  const from = Math.max(0, (options.page - 1) * options.limit);
  const to = from + options.limit - 1;
  let query = db
    .from("titles")
    .select(
      "id,canonical_url,code,slug,title,original_title,synopsis,release_date,duration_seconds,language,is_series,last_seen_at,is_active",
      { count: "exact" },
    )
    .neq("code", "articles")
    .neq("slug", "articles");

  if (activeMode !== "all") query = query.eq("is_active", activeMode === "active");

  if (filterIds) query = query.in("id", filterIds);

  const search = options.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,code.ilike.%${safe}%,original_title.ilike.%${safe}%`);
  }

  if (options.sort === "title") {
    query = query.order("title", { ascending: true, nullsFirst: false });
  } else if (options.sort === "release") {
    query = query.order("release_date", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("last_seen_at", { ascending: false, nullsFirst: false });
  }

  const titleResponse = await query.range(from, to);
  if (titleResponse.error) throw new Error(titleResponse.error.message);
  const titles = (titleResponse.data || []) as TitleRow[];
  return { items: await fetchCatalogItemsForTitles(db, titles), total: titleResponse.count || 0 };
}

export async function fetchAdminCatalogOverview(): Promise<AdminCatalogOverview> {
  const db = getCatalogDb();
  if (!db) {
    return {
      configured: false,
      activeTitles: 0,
      hiddenTitles: 0,
      readyTitles: 0,
      noPlayerTitles: 0,
      brokenTitles: 0,
      unknownTitles: 0,
      movieTitles: 0,
      seriesTitles: 0,
      sourceCount: 0,
      sourceStatus: { pass: 0, blocked: 0, error: 0, expired: 0, unknown: 0 },
      lastCheckedAt: new Date().toISOString(),
    };
  }

  const [activeResponse, hiddenResponse, titleRowsResponse, sourceRows] = await Promise.all([
    db.from("titles").select("id", { count: "exact", head: true }).eq("is_active", true).neq("code", "articles").neq("slug", "articles"),
    db.from("titles").select("id", { count: "exact", head: true }).eq("is_active", false).neq("code", "articles").neq("slug", "articles"),
    db.from("titles").select("id,is_series").eq("is_active", true).neq("code", "articles").neq("slug", "articles").range(0, 9999),
    fetchAllTitleLevelSources(db),
  ]);

  if (activeResponse.error) throw new Error(activeResponse.error.message);
  if (hiddenResponse.error) throw new Error(hiddenResponse.error.message);
  if (titleRowsResponse.error) throw new Error(titleRowsResponse.error.message);

  const titleRows = (titleRowsResponse.data || []) as Array<{ id: number; is_series: boolean }>;
  const titleIds = titleRows.map((row) => Number(row.id));
  const readyIds = new Set(titleIdsForFilter(titleIds, sourceRows, "ready") || []);
  const noPlayerIds = new Set(titleIdsForFilter(titleIds, sourceRows, "no-player") || []);
  const brokenIds = new Set(titleIdsForFilter(titleIds, sourceRows, "broken") || []);
  const unknownIds = new Set(titleIdsForFilter(titleIds, sourceRows, "unknown") || []);
  const sourceStatus: AdminCatalogOverview["sourceStatus"] = { pass: 0, blocked: 0, error: 0, expired: 0, unknown: 0 };
  for (const source of sourceRows) sourceStatus[source.status] += 1;

  return {
    configured: true,
    activeTitles: activeResponse.count || 0,
    hiddenTitles: hiddenResponse.count || 0,
    readyTitles: readyIds.size,
    noPlayerTitles: noPlayerIds.size,
    brokenTitles: brokenIds.size,
    unknownTitles: unknownIds.size,
    movieTitles: titleRows.filter((row) => !row.is_series).length,
    seriesTitles: titleRows.filter((row) => row.is_series).length,
    sourceCount: sourceRows.length,
    sourceStatus,
    lastCheckedAt: new Date().toISOString(),
  };
}

export async function fetchCatalogDetail(id: number): Promise<CatalogDetail | null> {
  const db = getCatalogDb();
  if (!db) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");

  const titleResponse = await db
    .from("titles")
    .select(
      "id,canonical_url,code,slug,title,original_title,synopsis,release_date,duration_seconds,language,is_series,last_seen_at,is_active",
    )
    .eq("id", id)
    .maybeSingle();
  if (titleResponse.error) throw new Error(titleResponse.error.message);
  if (!titleResponse.data) return null;

  const [assetsResponse, sourcesResponse, localizationsResponse, peopleLinksResponse, termLinksResponse] =
    await Promise.all([
      db.from("media_assets").select("title_id,kind,url,sort_order").eq("title_id", id).order("sort_order"),
      db
        .from("player_sources")
        .select("id,title_id,source_type,provider,player_page_url,media_url,origin,referer,is_primary,status,last_seen_at")
        .eq("title_id", id)
        .is("episode_id", null)
        .order("is_primary", { ascending: false }),
      db
        .from("title_localizations")
        .select("locale,title,original_title,synopsis")
        .eq("title_id", id)
        .order("locale"),
      db.from("title_people").select("role,person_id").eq("title_id", id).order("sort_order"),
      db.from("title_terms").select("term_id,source_label").eq("title_id", id).order("sort_order"),
    ]);

  for (const response of [assetsResponse, sourcesResponse, localizationsResponse, peopleLinksResponse, termLinksResponse]) {
    if (response.error) throw new Error(response.error.message);
  }

  const peopleLinks = (peopleLinksResponse.data || []) as Array<{ role: string; person_id: number }>;
  const termLinks = (termLinksResponse.data || []) as Array<{ term_id: number; source_label: string | null }>;
  const [peopleResponse, termsResponse] = await Promise.all([
    peopleLinks.length
      ? db.from("people").select("id,canonical_name,profile_url").in("id", peopleLinks.map((link) => link.person_id))
      : Promise.resolve({ data: [], error: null }),
    termLinks.length
      ? db.from("taxonomy_terms").select("id,term_type,name,raw_metadata").in("id", termLinks.map((link) => link.term_id))
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (peopleResponse.error) throw new Error(peopleResponse.error.message);
  if (termsResponse.error) throw new Error(termsResponse.error.message);

  const people = (peopleResponse.data || []) as Array<{ id: number; canonical_name: string; profile_url: string | null }>;
  const terms = (termsResponse.data || []) as Array<{
    id: number;
    term_type: string;
    name: string;
    raw_metadata: { url?: string | null } | null;
  }>;

  return {
    ...toCatalogItem(
      titleResponse.data as TitleRow,
      (assetsResponse.data || []) as AssetRow[],
      (sourcesResponse.data || []) as SourceRow[],
    ),
    images: ((assetsResponse.data || []) as AssetRow[]).map((asset) => ({
      kind: asset.kind,
      url: asset.url,
      sortOrder: asset.sort_order,
    })),
    localizations: ((localizationsResponse.data || []) as Array<{
      locale: string;
      title: string | null;
      original_title: string | null;
      synopsis: string | null;
    }>).map((localization) => ({
      locale: localization.locale,
      title: localization.title,
      originalTitle: localization.original_title,
      synopsis: localization.synopsis,
    })),
    people: peopleLinks.flatMap((link) => {
      const person = people.find((candidate) => candidate.id === link.person_id);
      return person ? [{ name: person.canonical_name, role: link.role, profileUrl: person.profile_url }] : [];
    }),
    terms: termLinks.flatMap((link) => {
      const term = terms.find((candidate) => candidate.id === link.term_id);
      return term
        ? [{ name: link.source_label || term.name, type: term.term_type, url: term.raw_metadata?.url || null }]
        : [];
    }),
  };
}
