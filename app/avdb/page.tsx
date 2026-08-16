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

const PAGE_SIZE = 24;

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

  const heroItem = items[0] || null;
  const hasMore = page < pageCount;
  const publishedLabel = useMemo(() => total.toLocaleString("en-US"), [total]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <nav className={styles.nav} aria-label="เมนู AVDBAPI">
          <Link href="/avdb" className={styles.active}>INDEX</Link>
          <Link href="/">SOURCE HOME</Link>
        </nav>
        <SourceSwitcher current="avdb" />
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>AVDBAPI / VERIFIED PUBLIC CATALOG</p>
          <h1>AVDB<br /><span>INDEX</span></h1>
          <p className={styles.description}>
            Catalog นี้แยกจาก MISSAV โดยสมบูรณ์ และแสดงเฉพาะรายการ AVDB ที่ผ่าน Staging, Duplicate Gate และ Player Verification ก่อน Publish แล้วเท่านั้น
          </p>
          <div className={styles.heroMeta}>
            <span>CATALOG: PUBLIC</span>
            <span>PLAYER GATE: REQUIRED</span>
            <span>MISSAV MERGE: DISABLED</span>
          </div>
        </div>

        <aside className={styles.heroPanel}>
          <div className={styles.panelCode}>AVDB / {String(total).padStart(2, "0")}</div>
          <div className={styles.panelRows}>
            <div><span>Source</span><strong>avdbapi.com</strong></div>
            <div><span>Catalog</span><strong>Published only</strong></div>
            <div><span>Published items</span><strong>{publishedLabel}</strong></div>
            <div><span>Player</span><strong>{heroItem ? "Verified" : "Waiting"}</strong></div>
          </div>
        </aside>
      </section>

      <section className={styles.workspace}>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.toolbarEyebrow}>PUBLIC CATALOG</p>
            <h2>รายการจาก AVDBAPI</h2>
            <p>ค้นหาจากรหัสหรือชื่อได้ทันที ข้อมูลในหน้านี้มาจาก Public Catalog หลังผ่าน Publish Gate เท่านั้น</p>
          </div>
          <label className={styles.searchBox}>
            <span>SEARCH</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา code / title" />
          </label>
        </div>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}

        {loading ? (
          <div className={styles.grid} aria-label="กำลังโหลด AVDB catalog">
            {Array.from({ length: 8 }, (_, index) => <div className={styles.skeletonCard} key={index}><div /><span /><small /></div>)}
          </div>
        ) : items.length ? (
          <>
            <div className={styles.grid} aria-label="AVDB public catalog">
              {items.map((item) => (
                <button className={styles.card} key={item.id} type="button" onClick={() => setSelected(item)}>
                  <div className={styles.cardVisual}>
                    {item.thumb_url || item.poster_url ? <img src={item.thumb_url || item.poster_url || ""} alt="" loading="lazy" /> : <span className={styles.crosshair}>+</span>}
                    <span className={styles.slot}>{item.movie_code || item.external_id || "AVDB"}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <strong>{item.title || item.movie_code || "Untitled"}</strong>
                    {item.original_title && item.original_title !== item.title ? <small>{item.original_title}</small> : null}
                    <div className={styles.cardMeta}>
                      {item.year ? <span>{item.year}</span> : null}
                      {item.quality ? <span>{item.quality}</span> : null}
                      {item.duration ? <span>{item.duration}</span> : null}
                    </div>
                  </div>
                </button>
              ))}
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
          <div className={styles.emptyState}>
            <strong>{debouncedQuery ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มี AVDB ที่ Publish"}</strong>
            <span>{debouncedQuery ? `ไม่พบ “${debouncedQuery}” ใน Public Catalog` : "เมื่อรายการผ่าน Player Verification และกด Publish จาก Admin แล้ว จะขึ้นตรงนี้ทันที"}</span>
          </div>
        )}

        <div className={styles.notice}>
          <strong>VERIFIED CATALOG</strong>
          <span>การเปิดหน้านี้อ่านเฉพาะ <code>/api/avdb/catalog</code> และไม่เรียก crawler หรือ <code>/api/avdb-scan</code></span>
        </div>
      </section>

      {selected ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelected(null)}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}>
            <button className={styles.modalClose} type="button" onClick={() => setSelected(null)}>×</button>
            <div className={styles.modalVisual}>
              {selected.poster_url || selected.thumb_url ? <img src={selected.poster_url || selected.thumb_url || ""} alt="" /> : <span>AVDB</span>}
            </div>
            <div className={styles.modalBody}>
              <p>{selected.movie_code || selected.external_id || "AVDB"}</p>
              <h2>{selected.title}</h2>
              {selected.original_title && selected.original_title !== selected.title ? <h3>{selected.original_title}</h3> : null}
              <div className={styles.modalMeta}>
                {selected.year ? <span>{selected.year}</span> : null}
                {selected.quality ? <span>{selected.quality}</span> : null}
                {selected.duration ? <span>{selected.duration}</span> : null}
                <span>PLAYER VERIFIED</span>
              </div>
              {selected.description ? <div className={styles.modalDescription}>{selected.description}</div> : null}
              <Link href={`/avdb/watch/${selected.id}`} className={styles.modalFooter} style={{ textDecoration: "none", color: "inherit" }}>
                <span>▶ WATCH VERIFIED SOURCE</span><strong>{selected.player_provider || "verified source"}</strong>
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
