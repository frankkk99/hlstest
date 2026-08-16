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

const PAGE_SIZE = 48;

function displayImage(item: CatalogItem) {
  return item.thumb_url || item.poster_url || "/cover-fallback.svg";
}

function MovieCard({ item, onSelect }: { item: CatalogItem; onSelect: (item: CatalogItem) => void }) {
  return (
    <button className={styles.card} type="button" onClick={() => onSelect(item)}>
      <div className={styles.cover}>
        <img src={displayImage(item)} alt={item.title || item.movie_code || "AVDB"} loading="lazy" />
        <span className={styles.coverShade} />
        <span className={styles.codeBadge}>{item.movie_code || item.external_id || "AVDB"}</span>
      </div>
      <div className={styles.cardBody}>
        <strong className={styles.cardTitle}>{item.title || item.movie_code || "Untitled"}</strong>
        {item.original_title && item.original_title !== item.title ? <small className={styles.originalTitle}>{item.original_title}</small> : null}
        <div className={styles.cardMeta}>
          {item.year ? <span>{item.year}</span> : null}
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
      if (!response.ok || !payload.ok) throw new Error(payload.error || "อ่าน AVDB catalog ไม่สำเร็จ");
      setItems((current) => append ? [...current, ...payload.items.filter((item) => !current.some((existing) => existing.id === item.id))] : payload.items);
      setPage(payload.page);
      setPageCount(payload.pageCount);
      setTotal(payload.total);
      setHeroIndex(0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่าน AVDB catalog ไม่สำเร็จ");
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

  const heroItems = useMemo(() => items.slice(0, 6), [items]);
  const hero = heroItems[Math.min(heroIndex, Math.max(0, heroItems.length - 1))] || null;
  const hasMore = page < pageCount;

  return (
    <main className={styles.storefront}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <nav className={styles.nav} aria-label="เมนู AVDBAPI">
          <Link href="/avdb" className={styles.navActive}>หน้าแรก</Link>
          <Link href="#catalog">รายการทั้งหมด</Link>
        </nav>
        <SourceSwitcher current="avdb" />
      </header>

      {hero ? (
        <section className={styles.hero} aria-label="AVDB เรื่องเด่น">
          <div className={styles.heroImage}>
            <img src={displayImage(hero)} alt="" />
          </div>
          <div className={styles.container}>
            <div className={styles.heroContent}>
              <p className={styles.heroKicker}>AVDB เรื่องเด่น</p>
              <h1 className={styles.heroTitle}>{hero.title || hero.movie_code || "AVDB"}</h1>
              <p className={styles.heroDescription}>{hero.description || "รายการจาก AVDB ที่พร้อมเปิด source สดเมื่อกดรับชม"}</p>
              <div className={styles.heroMeta}>
                {hero.year ? <span>{hero.year}</span> : null}
                {hero.quality ? <span>{hero.quality}</span> : null}
                {hero.duration ? <span>{hero.duration}</span> : null}
                <span>{hero.movie_code || hero.external_id || "AVDB"}</span>
              </div>
              <div className={styles.heroActions}>
                <Link className={styles.primaryButton} href={`/avdb/watch/${hero.id}`}>▶ เริ่มรับชม</Link>
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(hero)}>ดูรายละเอียด</button>
              </div>
              <div className={styles.heroChoices} aria-label="เลือกเรื่องเด่น">
                {heroItems.map((item, index) => (
                  <button
                    key={item.id}
                    className={`${styles.heroChoice} ${index === heroIndex ? styles.heroChoiceActive : ""}`}
                    type="button"
                    onClick={() => setHeroIndex(index)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.movie_code || item.title}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className={styles.container} id="catalog">
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.sectionTitle}>AVDB ทั้งหมด</h2>
            <p className={styles.sectionNote}>มีรายการที่ Publish แล้ว {total.toLocaleString()} เรื่อง · Player resolve สดตอนกดดู</p>
          </div>
          <label className={styles.searchBox}>
            <span>ค้นหา</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา code / title..." />
          </label>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        {loading ? (
          <div className={styles.cardGrid} aria-label="กำลังโหลด AVDB catalog">
            {Array.from({ length: 12 }, (_, index) => <div className={styles.skeletonCard} key={index}><div /><span /><small /></div>)}
          </div>
        ) : items.length ? (
          <>
            <section className={styles.row}>
              <div className={styles.rowHeader}>
                <h2>{debouncedQuery ? `ผลการค้นหา “${debouncedQuery}”` : "พร้อมเปิด Source"}</h2>
                <span>{items.length} / {total.toLocaleString()} เรื่อง</span>
              </div>
              <div className={styles.cardGrid}>
                {items.map((item) => <MovieCard key={item.id} item={item} onSelect={setSelected} />)}
              </div>
            </section>
            {hasMore ? (
              <div className={styles.loadMoreWrap}>
                <button type="button" disabled={loadingMore} onClick={() => void fetchPage(page + 1, true, debouncedQuery)}>
                  {loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>{debouncedQuery ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี AVDB ที่ Publish"}</div>
        )}
      </div>

      {selected ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={selected.title}>
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            <div className={styles.modalCover}>
              <img src={selected.poster_url || selected.thumb_url || "/cover-fallback.svg"} alt="" />
            </div>
            <div className={styles.modalContent}>
              <span className={styles.modalLabel}>{selected.movie_code || selected.external_id || "AVDB"}</span>
              <h2 className={styles.modalTitle}>{selected.title}</h2>
              {selected.original_title && selected.original_title !== selected.title ? <p className={styles.modalOriginal}>{selected.original_title}</p> : null}
              <p className={styles.modalDescription}>{selected.description || "รายการนี้จะสร้าง Browser Session ใหม่และ resolve Player สดเมื่อเริ่มรับชม"}</p>
              <div className={styles.modalMeta}>
                {selected.year ? <span>{selected.year}</span> : null}
                {selected.quality ? <span>{selected.quality}</span> : null}
                {selected.duration ? <span>{selected.duration}</span> : null}
                <span>{selected.player_provider || "live source"}</span>
              </div>
              <div className={styles.modalActions}>
                <Link className={styles.primaryButton} href={`/avdb/watch/${selected.id}`}>▶ รับชมเรื่องนี้</Link>
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(null)}>ปิดหน้าต่าง</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
