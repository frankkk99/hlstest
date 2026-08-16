"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prewarmAvdbPlayback } from "@/lib/avdb-prewarm-client";
import SourceSwitcher from "../source-switcher";
import ExpandableText from "./expandable-text";
import styles from "./avdb.module.css";
import ui from "./ui-polish.module.css";

type CatalogItem = {
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
  categories: string[];
  published_at: string;
};

type CatalogResponse = {
  ok: boolean;
  error?: string;
  page: number;
  limit: number;
  total: number;
  pageCount: number;
  category?: string;
  items: CatalogItem[];
};

type QuickFilter = "all" | "latest" | "hd" | "long";

const PAGE_SIZE = 48;
const HOVER_PREWARM_DELAY_MS = 700;

const CATEGORY_FILTERS = [
  ["fc2", "FC2"],
  ["uncensored", "ไม่เซ็นเซอร์"],
  ["first-shoot", "ถ่ายครั้งแรก"],
  ["private", "ถ่ายส่วนตัว"],
  ["amateur", "สมัครเล่น"],
  ["mature", "สาวใหญ่"],
  ["ntr", "NTR"],
  ["cosplay", "คอสเพลย์"],
  ["pov", "POV"],
  ["group", "หลายคน"],
  ["massage", "นวด / Soap"],
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  fc2: "FC2",
  "1pondo": "1Pondo",
  caribbeancom: "Caribbeancom",
  heyzo: "Heyzo",
  pacopacomama: "Pacopacomama",
  "10musume": "10Musume",
  uncensored: "ไม่เซ็นเซอร์",
  "first-shoot": "ถ่ายครั้งแรก",
  private: "ถ่ายส่วนตัว",
  amateur: "สมัครเล่น",
  mature: "สาวใหญ่",
  ntr: "NTR",
  cosplay: "คอสเพลย์",
  pov: "POV",
  group: "หลายคน",
  massage: "นวด / Soap",
  hd: "HD",
  "60-plus": "60 นาที+",
  "90-plus": "90 นาที+",
};

function categoryLabel(value: string) {
  return CATEGORY_LABELS[value] || value;
}

function displayImage(item: CatalogItem) {
  return item.thumb_url || item.poster_url || "/cover-fallback.svg";
}

function codeLabel(item: CatalogItem) {
  return item.movie_code || item.external_id || "AVDB";
}

function durationMinutes(value: string | null) {
  if (!value) return 0;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0] || 0;
}

function hasCategory(item: CatalogItem, category: string) {
  return Array.isArray(item.categories) && item.categories.includes(category);
}

function matchesFilter(item: CatalogItem, filter: QuickFilter) {
  if (filter === "hd") return hasCategory(item, "hd") || /hd|1080|720/i.test(item.quality || "");
  if (filter === "long") return hasCategory(item, "60-plus") || durationMinutes(item.duration) >= 60;
  return true;
}

function quickFilterLabel(filter: QuickFilter) {
  if (filter === "latest") return "มาใหม่";
  if (filter === "hd") return "HD";
  if (filter === "long") return "60 นาที+";
  return "รายการทั้งหมด";
}

function StorefrontSkeleton() {
  return (
    <main className={ui.pageSkeleton} aria-label="กำลังโหลดหน้า AVDB">
      <div className={ui.skeletonShell}>
        <div className={ui.skeletonHero} />
        <div className={ui.skeletonChips}>
          {Array.from({ length: 7 }, (_, index) => <span className={ui.skeletonChip} key={index} />)}
        </div>
        <div className={`${ui.skeletonLine} ${ui.skeletonLineWide}`} />
        <div className={`${ui.skeletonLine} ${ui.skeletonLineShort}`} />
        <div className={ui.skeletonGrid}>
          {Array.from({ length: 12 }, (_, index) => (
            <div className={ui.skeletonCard} key={index}>
              <div className={ui.skeletonCardImage} />
              <span className={ui.skeletonCardLine} />
              <span className={ui.skeletonCardLine} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function MovieCard({
  item,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
  onHoverStart: (item: CatalogItem) => void;
  onHoverEnd: () => void;
}) {
  return (
    <button
      className={styles.card}
      type="button"
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHoverStart(item)}
      onMouseLeave={onHoverEnd}
      onFocus={() => onHoverStart(item)}
      onBlur={onHoverEnd}
    >
      <div className={styles.cover}>
        <img src={displayImage(item)} alt={item.title || codeLabel(item)} loading="lazy" />
        <span className={styles.coverShade} />
        <span className={styles.hoverPlay} aria-hidden="true">▶</span>
      </div>
      <div className={styles.cardBody}>
        <strong className={`${styles.cardTitle} ${ui.cardTitle3}`}>{item.title || codeLabel(item)}</strong>
        <div className={styles.cardMeta}>
          <span>{codeLabel(item)}</span>
          {item.quality ? <span>{item.quality}</span> : null}
          {item.duration ? <span>{item.duration}</span> : null}
        </div>
      </div>
    </button>
  );
}

export default function AvdbStorefrontPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (targetPage: number, append: boolean, search: string, category: string) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) });
      if (search) params.set("q", search);
      if (category) params.set("category", category);
      const response = await fetch(`/api/avdb/catalog?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as CatalogResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "โหลดรายการไม่สำเร็จ");
      setItems((current) => append ? [...current, ...payload.items.filter((item) => !current.some((existing) => existing.id === item.id))] : payload.items);
      setPage(payload.page);
      setPageCount(payload.pageCount);
      setTotal(payload.total);
      if (!append) setHeroIndex(0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายการไม่สำเร็จ");
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    void fetchPage(1, false, debouncedQuery, selectedCategory);
  }, [debouncedQuery, selectedCategory, fetchPage]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!selected?.id) return;
    void prewarmAvdbPlayback(selected.id);
  }, [selected?.id]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const filteredItems = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter]);
  const heroItems = useMemo(() => items.slice(0, 6), [items]);
  const hero = heroItems[Math.min(heroIndex, Math.max(0, heroItems.length - 1))] || null;
  const hasMore = page < pageCount;
  const categoryTitle = selectedCategory ? categoryLabel(selectedCategory) : "";
  const catalogTitle = debouncedQuery
    ? `ผลการค้นหา “${debouncedQuery}”`
    : selectedCategory
      ? `หมวด ${categoryTitle}`
      : quickFilterLabel(filter);

  function chooseQuickFilter(value: QuickFilter) {
    setSelectedCategory("");
    setFilter(value);
  }

  function chooseCategory(value: string) {
    setFilter("all");
    setSelectedCategory((current) => current === value ? "" : value);
  }

  function cancelHoverPrewarm() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function scheduleHoverPrewarm(item: CatalogItem) {
    cancelHoverPrewarm();
    if (typeof window.matchMedia === "function" && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      void prewarmAvdbPlayback(item.id);
    }, HOVER_PREWARM_DELAY_MS);
  }

  if (loading && !items.length && !error) return <StorefrontSkeleton />;

  return (
    <main className={styles.storefront}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <nav className={styles.nav} aria-label="เมนู AVDB">
          <Link href="/avdb" className={styles.navActive}>หน้าแรก</Link>
          <Link href="#catalog">มาใหม่</Link>
          <Link href="#categories">หมวดหมู่</Link>
          <Link href="#catalog">ทั้งหมด</Link>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.headerSearch} href="#catalog">⌕ ค้นหา</a>
          <SourceSwitcher current="avdb" />
        </div>
      </header>

      {hero ? (
        <section className={styles.hero} aria-label="AVDB เรื่องเด่น">
          <div className={styles.heroImage}><img src={displayImage(hero)} alt="" /></div>
          <div className={styles.container}>
            <div className={styles.heroContent}>
              <p className={styles.heroKicker}>{selectedCategory ? `หมวด ${categoryTitle}` : "เรื่องเด่นจาก AVDB"}</p>
              <ExpandableText as="h1" lines={3} text={hero.title || codeLabel(hero)} className={styles.heroTitle} />
              <ExpandableText as="p" lines={3} text={hero.description || "เลือกเรื่องที่ต้องการ แล้วเริ่มรับชมได้ทันที"} className={styles.heroDescription} />
              <div className={styles.heroMeta}>
                <span>{codeLabel(hero)}</span>
                {hero.quality ? <span>{hero.quality}</span> : null}
                {hero.duration ? <span>{hero.duration}</span> : null}
              </div>
              <div className={styles.heroActions}>
                <Link
                  className={styles.primaryButton}
                  href={`/avdb/watch/${hero.id}`}
                  onMouseEnter={() => scheduleHoverPrewarm(hero)}
                  onMouseLeave={cancelHoverPrewarm}
                >▶ รับชม</Link>
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(hero)}>รายละเอียด</button>
              </div>
            </div>
            <div className={styles.heroThumbs} aria-label="เลือกเรื่องเด่น">
              {heroItems.map((item, index) => (
                <button
                  key={item.id}
                  className={`${styles.heroThumb} ${index === heroIndex ? styles.heroThumbActive : ""}`}
                  type="button"
                  onClick={() => setHeroIndex(index)}
                  aria-label={`เลือก ${item.title || codeLabel(item)}`}
                >
                  <img src={displayImage(item)} alt="" />
                  <span>{codeLabel(item)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <div className={styles.container}>
        <div className={styles.quickFilters} aria-label="ตัวกรองด่วน">
          {([[
            "all", "ทั้งหมด"
          ], [
            "latest", "มาใหม่"
          ], [
            "hd", "HD"
          ], [
            "long", "60 นาที+"
          ]] as Array<[QuickFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={!selectedCategory && filter === value ? styles.quickActive : ""} onClick={() => chooseQuickFilter(value)}>{label}</button>
          ))}
        </div>

        <div className={styles.quickFilters} id="categories" aria-label="หมวดหมู่จากชื่อเรื่อง">
          {CATEGORY_FILTERS.map(([value, label]) => (
            <button key={value} type="button" className={selectedCategory === value ? styles.quickActive : ""} onClick={() => chooseCategory(value)}>{label}</button>
          ))}
        </div>

        <section className={styles.catalogSection} id="catalog">
          <div className={styles.toolbar}>
            <div>
              <h2 className={styles.sectionTitle}>{catalogTitle}</h2>
              <p className={styles.sectionNote}>มีทั้งหมด {total.toLocaleString()} เรื่อง</p>
            </div>
            <label className={styles.searchBox}>
              <span>ค้นหาหนัง</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา code / title..." />
            </label>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          {loading ? (
            <div className={styles.cardGrid} aria-label="กำลังโหลด AVDB catalog">
              {Array.from({ length: 12 }, (_, index) => <div className={styles.skeletonCard} key={index}><div /><span /><small /></div>)}
            </div>
          ) : filteredItems.length ? (
            <>
              <div className={styles.cardGrid}>
                {filteredItems.map((item) => (
                  <MovieCard
                    key={item.id}
                    item={item}
                    onSelect={setSelected}
                    onHoverStart={scheduleHoverPrewarm}
                    onHoverEnd={cancelHoverPrewarm}
                  />
                ))}
              </div>
              {hasMore ? (
                <div className={styles.loadMoreWrap}>
                  <button type="button" disabled={loadingMore} onClick={() => void fetchPage(page + 1, true, debouncedQuery, selectedCategory)}>
                    {loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.empty}>{debouncedQuery ? "ไม่พบรายการที่ค้นหา" : selectedCategory ? "ยังไม่มีรายการในหมวดนี้" : "ไม่มีรายการในตัวกรองนี้"}</div>
          )}
        </section>
      </div>

      {selected ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className={`${styles.modal} ${ui.modalShell}`} role="dialog" aria-modal="true" aria-label={selected.title}>
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            <div className={`${styles.modalCover} ${ui.modalMedia}`}><img src={selected.thumb_url || selected.poster_url || "/cover-fallback.svg"} alt="" /></div>
            <div className={`${styles.modalContent} ${ui.modalBody}`}>
              <span className={styles.modalLabel}>{codeLabel(selected)}</span>
              <ExpandableText as="h2" lines={3} text={selected.title || codeLabel(selected)} className={`${styles.modalTitle} ${ui.modalTitleText}`} />
              {selected.original_title && selected.original_title !== selected.title ? (
                <ExpandableText as="p" lines={3} text={selected.original_title} className={styles.modalOriginal} />
              ) : null}
              <ExpandableText as="p" lines={3} text={selected.description || "พร้อมรับชมแล้ว"} className={`${styles.modalDescription} ${ui.modalDescriptionText}`} />
              <div className={styles.modalMeta}>
                {selected.year ? <span>{selected.year}</span> : null}
                {selected.quality ? <span>{selected.quality}</span> : null}
                {selected.duration ? <span>{selected.duration}</span> : null}
                {(selected.categories || []).filter((value) => !["hd", "60-plus", "90-plus"].includes(value)).slice(0, 5).map((value) => <span key={value}>{categoryLabel(value)}</span>)}
              </div>
              <div className={styles.modalActions}>
                <Link className={styles.primaryButton} href={`/avdb/watch/${selected.id}`}>▶ รับชมทันที</Link>
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(null)}>ปิด</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
