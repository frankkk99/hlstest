"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./avdb.module.css";

type AvdbItem = {
  row: number;
  apiUrl: string;
  apiStatus: number;
  apiElapsedMs: number;
  id: number | null;
  name: string;
  slug: string;
  movieCode: string;
  typeName: string;
  year: string;
  quality: string;
  duration: string;
  posterUrl: string;
  thumbUrl: string;
  playerUrl: string | null;
};

type ScanResponse = {
  ok: boolean;
  error?: string;
  itemsFound?: number;
  items?: AvdbItem[];
};

function pageUrl(page: number) {
  return page <= 1 ? "https://avdbapi.com/" : `https://avdbapi.com/index-${page}/`;
}

function itemKey(item: AvdbItem) {
  return String(item.id ?? item.movieCode || item.slug || item.apiUrl);
}

function imageUrl(item: AvdbItem) {
  return item.thumbUrl || item.posterUrl || "/cover-fallback.svg";
}

function mergeUnique(previous: AvdbItem[], incoming: AvdbItem[]) {
  const map = new Map<string, AvdbItem>();
  for (const item of [...previous, ...incoming]) map.set(itemKey(item), item);
  return [...map.values()];
}

export default function AvdbStorefrontPage() {
  const [items, setItems] = useState<AvdbItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AvdbItem | null>(null);

  async function load(targetPage: number, append = false) {
    append ? setLoadingMore(true) : setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/avdb-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: pageUrl(targetPage) }),
      });
      const data = (await response.json()) as ScanResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "โหลดข้อมูล AVDBAPI ไม่สำเร็จ");

      const nextItems = data.items || [];
      setItems((previous) => append ? mergeUnique(previous, nextItems) : mergeUnique([], nextItems));
      setPage(targetPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูล AVDBAPI ไม่สำเร็จ");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load(1, false);
  }, []);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.movieCode, item.slug, item.year, item.quality, item.typeName]
        .some((field) => String(field || "").toLowerCase().includes(value)),
    );
  }, [items, query]);

  const hero = filtered[0] || items[0] || null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>HLS<span>HUB</span> · AVDBAPI</Link>
        <nav className={styles.nav} aria-label="เมนู AVDBAPI">
          <Link href="/avdb" className={styles.active}>หน้าแรก</Link>
          <Link href="/hub">MISSAV</Link>
          <Link href="/">เปลี่ยนแหล่ง</Link>
        </nav>
      </header>

      {hero && (
        <section className={styles.hero} aria-label="เรื่องเด่น AVDBAPI">
          <div className={styles.heroMedia}>
            <img src={imageUrl(hero)} alt="" onError={(event) => { event.currentTarget.src = "/cover-fallback.svg"; }} />
          </div>
          <div className={styles.heroBody}>
            <p className={styles.kicker}>AVDBAPI · LATEST SOURCE</p>
            <h1 className={styles.heroTitle}>{hero.name || hero.movieCode || "AVDBAPI"}</h1>
            <div className={styles.heroMeta}>
              {hero.movieCode && <span>{hero.movieCode}</span>}
              {hero.year && <span>{hero.year}</span>}
              {hero.quality && <span>{hero.quality}</span>}
              {hero.duration && <span>{hero.duration}</span>}
            </div>
            <div className={styles.heroActions}>
              <button className={styles.primary} type="button" onClick={() => setSelected(hero)}>ดูรายละเอียด</button>
              <Link className={styles.secondary} href="/">เปลี่ยนแหล่งข้อมูล</Link>
            </div>
          </div>
        </section>
      )}

      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.title}>AVDBAPI</h2>
            <p className={styles.note}>โหลดแล้ว {items.length.toLocaleString()} รายการ · หน้า {page.toLocaleString()}</p>
          </div>
          <input
            className={styles.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อ / รหัส / ปี..."
            aria-label="ค้นหา AVDBAPI"
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.skeletonGrid} aria-label="กำลังโหลด">
            {Array.from({ length: 10 }).map((_, index) => <div key={index} className={styles.skeleton} />)}
          </div>
        ) : filtered.length ? (
          <div className={styles.grid}>
            {filtered.map((item) => (
              <button key={itemKey(item)} className={styles.card} type="button" onClick={() => setSelected(item)}>
                <div className={styles.thumb}>
                  <img src={imageUrl(item)} alt={item.name || item.movieCode || "AVDBAPI"} loading="lazy" onError={(event) => { event.currentTarget.src = "/cover-fallback.svg"; }} />
                  <span className={styles.thumbShade} />
                </div>
                <div className={styles.cardBody}>
                  <strong className={styles.cardTitle}>{item.name || item.movieCode || item.slug}</strong>
                  <div className={styles.cardMeta}>
                    {item.movieCode && <span className={styles.cardCode}>{item.movieCode}</span>}
                    {item.year && <span>{item.year}</span>}
                    {item.quality && <span>{item.quality}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>{query ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีข้อมูล AVDBAPI"}</div>
        )}

        {!loading && !query && items.length > 0 && (
          <div className={styles.loadMoreWrap}>
            <button className={styles.secondary} type="button" disabled={loadingMore} onClick={() => void load(page + 1, true)}>
              {loadingMore ? "กำลังโหลดหน้าถัดไป..." : `โหลดเพิ่ม · หน้า ${page + 1}`}
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="รายละเอียด AVDBAPI">
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            <div className={styles.modalImage}>
              <img src={selected.posterUrl || imageUrl(selected)} alt="" onError={(event) => { event.currentTarget.src = "/cover-fallback.svg"; }} />
            </div>
            <div className={styles.modalContent}>
              <span className={styles.modalLabel}>AVDBAPI SOURCE</span>
              <h2 className={styles.modalTitle}>{selected.name || selected.movieCode || selected.slug}</h2>
              <p className={styles.modalText}>
                ข้อมูลรายการนี้อ่านจาก AVDBAPI โดยตรง และแยกออกจาก catalog ของ MISSAV
              </p>
              <div className={styles.modalMeta}>
                {selected.movieCode && <span className={styles.pill}>{selected.movieCode}</span>}
                {selected.typeName && <span className={styles.pill}>{selected.typeName}</span>}
                {selected.year && <span className={styles.pill}>{selected.year}</span>}
                {selected.quality && <span className={styles.pill}>{selected.quality}</span>}
                {selected.duration && <span className={styles.pill}>{selected.duration}</span>}
              </div>
              <div className={styles.modalActions}>
                {selected.playerUrl && (
                  <a className={styles.primary} href={selected.playerUrl} target="_blank" rel="noreferrer">เปิด Player</a>
                )}
                <button className={styles.secondary} type="button" onClick={() => setSelected(null)}>ปิด</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
