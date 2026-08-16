"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./source-select.module.css";

type CatalogItem = {
  id: string;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_provider: string | null;
};

type CatalogResponse = {
  ok: boolean;
  error?: string;
  page?: number;
  pageCount?: number;
  total?: number;
  items?: CatalogItem[];
};

const GATEWAY_ORIGIN = "https://dev2u.online";
const PAGE_SIZE = 100;

function embedUrl(id: string) {
  return `${GATEWAY_ORIGIN}/embed/${id}`;
}

function wrapperCode(id: string) {
  return `<iframe src="${embedUrl(id)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="eager" style="width:100%;aspect-ratio:16/9;border:0"></iframe>`;
}

export default function PlayerGatewayHomePage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const firstResponse = await fetch(`/api/avdb/catalog?page=1&limit=${PAGE_SIZE}`, { cache: "no-store" });
        const first = (await firstResponse.json()) as CatalogResponse;
        if (!firstResponse.ok || !first.ok) throw new Error(first.error || "โหลดรายการ Player Gateway ไม่สำเร็จ");

        let merged = first.items || [];
        const pageCount = Math.max(1, Number(first.pageCount || 1));
        if (pageCount > 1) {
          for (let page = 2; page <= pageCount; page += 1) {
            const response = await fetch(`/api/avdb/catalog?page=${page}&limit=${PAGE_SIZE}`, { cache: "no-store" });
            const payload = (await response.json()) as CatalogResponse;
            if (!response.ok || !payload.ok) throw new Error(payload.error || `โหลดรายการหน้า ${page} ไม่สำเร็จ`);
            merged = merged.concat(payload.items || []);
          }
        }

        if (!active) return;
        const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        setItems(unique);
        setTotal(Number(first.total || unique.length));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "โหลดรายการไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, []);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, item.original_title, item.movie_code, item.external_id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [items, query]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1400);
    } catch {
      setCopied("");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>PLAYER<span>GATEWAY</span></Link>
          <nav className={styles.headerActions}>
            <Link href="/avdb">AVDB</Link>
            <Link href="/admin">Admin</Link>
          </nav>
        </header>

        <section className={styles.toolbar}>
          <div>
            <h1>Wrapper พร้อมใช้</h1>
            <p>{loading ? "กำลังโหลดรายการ…" : `${visibleItems.length.toLocaleString()} / ${total.toLocaleString()} รายการ`}</p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อเรื่อง / รหัส"
            aria-label="ค้นหา Player Gateway"
          />
        </section>

        {error ? <div className={styles.stateBox}>{error}</div> : null}
        {loading ? <div className={styles.stateBox}>กำลังดึงรายการ Player Gateway…</div> : null}

        {!loading && !error ? (
          <section className={styles.list} aria-label="รายการ Player Gateway">
            {visibleItems.map((item) => {
              const poster = item.thumb_url || item.poster_url || "";
              const code = item.movie_code || item.external_id || "AVDB";
              const url = embedUrl(item.id);
              const wrap = wrapperCode(item.id);
              return (
                <article className={styles.row} key={item.id}>
                  <div className={styles.thumb}>{poster ? <img src={poster} alt="" loading="lazy" /> : null}</div>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTop}>
                      <div className={styles.nameBlock}>
                        <span className={styles.code}>{code}</span>
                        <h2>{item.title}</h2>
                        <div className={styles.meta}>
                          {item.year ? <span>{item.year}</span> : null}
                          {item.quality ? <span>{item.quality}</span> : null}
                          {item.duration ? <span>{item.duration}</span> : null}
                          {item.player_provider ? <span>{item.player_provider}</span> : null}
                        </div>
                      </div>
                      <Link href={`/player/${item.id}`} className={styles.testButton}>เปิดเทส</Link>
                    </div>

                    <div className={styles.wrapBox}>
                      <code>{wrap}</code>
                      <div className={styles.copyActions}>
                        <button type="button" onClick={() => void copy(wrap, `wrap:${item.id}`)}>
                          {copied === `wrap:${item.id}` ? "คัดลอกแล้ว" : "คัดลอก Wrap"}
                        </button>
                        <button type="button" onClick={() => void copy(url, `url:${item.id}`)}>
                          {copied === `url:${item.id}` ? "คัดลอกแล้ว" : "คัดลอก URL"}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            {!visibleItems.length ? <div className={styles.stateBox}>ไม่พบรายการที่ค้นหา</div> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
