"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import SourceSwitcher from "../source-switcher";
import styles from "./avdb.module.css";

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
  published_at: string;
};

type CatalogResponse = {
  ok: boolean;
  error?: string;
  page: number;
  limit: number;
  total: number;
  pageCount: number;
  items: CatalogItem[];
};

type QuickFilter = "all" | "latest" | "hd" | "fc2" | "long";

const PAGE_SIZE = 48;

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

function matchesFilter(item: CatalogItem, filter: QuickFilter) {
  if (filter === "hd") return /hd|1080|720/i.test(item.quality || "");
  if (filter === "fc2") return /fc2/i.test(`${item.movie_code || ""} ${item.title || ""}`);
  if (filter === "long") return durationMinutes(item.duration) >= 60;
  return true;
}

function MovieCard({ item, onSelect, compact = false }: { item: CatalogItem; onSelect: (item: CatalogItem) => void; compact?: boolean }) {
  return (
    <button className={`${styles.card} ${compact ? styles.cardCompact : ""}`} type="button" onClick={() => onSelect(item)}>
      <div className={styles.cover}>
        <img src={displayImage(item)} alt={item.title || codeLabel(item)} loading="lazy" />
        <span className={styles.coverShade} />
        <span className={styles.hoverPlay} aria-hidden="true">▶</span>
      </div>
      <div className={styles.cardBody}>
        <strong className={styles.cardTitle}>{item.title || codeLabel(item)}</strong>
        <div className={styles.cardMeta}>
          <span>{codeLabel(item)}</span>
          {item.quality ? <span>{item.quality}</span> : null}
          {item.duration ? <span>{item.duration}</span> : null}
        </div>
      </div>
    </button>
  );
}

function HorizontalRow({ title, note, items, onSelect, anchor }: { title: string; note: string; items: CatalogItem[]; onSelect: (item: CatalogItem) => void; anchor?: string }) {
  if (!items.length) return null;
  return (
    <section className={styles.carouselSection} id={anchor}>
      <div className={styles.rowHeader}>
        <div><h2>{title}</h2><p>{note}</p></div>
        <span>{items.length} เรื่อง</span>
      </div>
      <div className={styles.carouselTrack}>
        {items.map((item) => <MovieCard key={item.id} item={item} onSelect={onSelect} compact />)}
      </div>
    </section>
  );
}

export default function AvdbStorefrontPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (targetPage: number, append: boolean, search: string) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) });
      if (search) params.set("q", search);
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
    void fetchPage(1, false, debouncedQuery);
  }, [debouncedQuery, fetchPage]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const filteredItems = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter]);
  const heroItems = useMemo(() => items.slice(0, 6), [items]);
  const hero = heroItems[Math.min(heroIndex, Math.max(0, heroItems.length - 1))] || null;
  const latestItems = useMemo(() => items.slice(0, 12), [items]);
  const fc2Items = useMemo(() => items.filter((item) => matchesFilter(item, "fc2")).slice(0, 12), [items]);
  const longItems = useMemo(() => items.filter((item) => matchesFilter(item, "long")).slice(0, 12), [items]);
  const hasMore = page < pageCount;

  return (
    <main className={styles.storefront}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <nav className={styles.nav} aria-label="เมนู AVDB">
          <Link href="/avdb" className={styles.navActive}>หน้าแรก</Link>
          <Link href="#latest">มาใหม่</Link>
          <Link href="#fc2">FC2</Link>
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
              <p className={styles.heroKicker}>เรื่องเด่นจาก AVDB</p>
              <h1 className={styles.heroTitle}>{hero.title || codeLabel(hero)}</h1>
              <p className={styles.heroDescription}>{hero.description || "เลือกเรื่องที่ต้องการ แล้วเริ่มรับชมได้ทันที"}</p>
              <div className={styles.heroMeta}>
                <span>{codeLabel(hero)}</span>
                {hero.quality ? <span>{hero.quality}</span> : null}
                {hero.duration ? <span>{hero.duration}</span> : null}
              </div>
              <div className={styles.heroActions}>
                <Link className={styles.primaryButton} href={`/avdb/watch/${hero.id}`}>▶ รับชม</Link>
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
        {!debouncedQuery ? (
          <>
            <div className={styles.quickFilters} aria-label="ตัวกรองด่วน">
              {([
                ["all", "ทั้งหมด"],
                ["latest", "มาใหม่"],
                ["hd", "HD"],
                ["fc2", "FC2"],
                ["long", "60 นาที+"],
              ] as Array<[QuickFilter, string]>).map(([value, label]) => (
                <button key={value} type="button" className={filter === value ? styles.quickActive : ""} onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>

            <HorizontalRow title="มาใหม่" note="รายการล่าสุดที่เพิ่งเข้ามา" items={latestItems} onSelect={setSelected} anchor="latest" />
            <HorizontalRow title="FC2" note="รวมรหัส FC2 ที่มีในชุดปัจจุบัน" items={fc2Items} onSelect={setSelected} anchor="fc2" />
            <HorizontalRow title="ดูยาว 60 นาที+" note="เหมาะสำหรับเปิดดูต่อเนื่อง" items={longItems} onSelect={setSelected} />
          </>
        ) : null}

        <section className={styles.catalogSection} id="catalog">
          <div className={styles.toolbar}>
            <div>
              <h2 className={styles.sectionTitle}>{debouncedQuery ? `ผลการค้นหา “${debouncedQuery}”` : "รายการทั้งหมด"}</h2>
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
                {filteredItems.map((item) => <MovieCard key={item.id} item={item} onSelect={setSelected} />)}
              </div>
              {hasMore ? (
                <div className={styles.loadMoreWrap}>
                  <button type="button" disabled={loadingMore} onClick={() => void fetchPage(page + 1, true, debouncedQuery)}>
                    {loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.empty}>{debouncedQuery ? "ไม่พบรายการที่ค้นหา" : "ไม่มีรายการในตัวกรองนี้"}</div>
          )}
        </section>
      </div>

      {selected ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={selected.title}>
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            <div className={styles.modalCover}><img src={selected.poster_url || selected.thumb_url || "/cover-fallback.svg"} alt="" /></div>
            <div className={styles.modalContent}>
              <span className={styles.modalLabel}>{codeLabel(selected)}</span>
              <h2 className={styles.modalTitle}>{selected.title}</h2>
              {selected.original_title && selected.original_title !== selected.title ? <p className={styles.modalOriginal}>{selected.original_title}</p> : null}
              <p className={styles.modalDescription}>{selected.description || "พร้อมรับชมแล้ว"}</p>
              <div className={styles.modalMeta}>
                {selected.year ? <span>{selected.year}</span> : null}
                {selected.quality ? <span>{selected.quality}</span> : null}
                {selected.duration ? <span>{selected.duration}</span> : null}
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
