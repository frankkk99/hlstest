"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./browse.module.css";
import { displayTitle, durationLabel, imageUrl, type StorefrontItem, yearLabel } from "./storefront";

type BrowseMode = "movies" | "series";
type CatalogResponse = { ok: boolean; error?: string; total?: number; items?: StorefrontItem[] };

function BrowseCard({ item }: { item: StorefrontItem }) {
  return <Link href={`/hub/watch/${item.id}`} className={styles.card}>
    <div className={styles.cover}>
      <Image src={imageUrl(item.coverUrl)} alt={displayTitle(item)} fill unoptimized sizes="(max-width: 760px) 50vw, (max-width: 1120px) 25vw, 16vw" onError={(event) => { event.currentTarget.src = "/cover-fallback.svg"; }} />
    </div>
    <div className={styles.cardBody}><strong>{displayTitle(item)}</strong><span>{yearLabel(item.releaseDate)} · {durationLabel(item.durationSeconds)}</span></div>
  </Link>;
}

export default function BrowsePage({ mode }: { mode: BrowseMode }) {
  const [items, setItems] = useState<StorefrontItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const title = mode === "series" ? "ซีรีส์ทั้งหมด" : "หนังทั้งหมด";
  const filtered = useMemo(() => items.filter((item) => item.hasPlayer && (mode === "series" ? item.isSeries : !item.isSeries)), [items, mode]);
  const hasMore = page * 48 < total;

  async function load(nextPage = 1, append = false) {
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "48", sort: "latest", ready: "1" });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/catalog?${params}`, { cache: "default" });
      const data = (await response.json()) as CatalogResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "ยังโหลดรายการไม่สำเร็จ");
      setItems((current) => append ? [...current, ...(data.items || [])] : data.items || []);
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ยังโหลดรายการไม่สำเร็จ");
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return <main className={styles.page}>
    <div className={styles.container}>
      <div className={styles.topline}><div><p className={styles.kicker}>HLSHUB</p><h1>{title}</h1><p>เลือกเรื่องที่ต้องการรับชมจากรายการล่าสุด</p></div><span>{filtered.length.toLocaleString()} เรื่อง</span></div>
      <form className={styles.searchbar} onSubmit={(event) => { event.preventDefault(); void load(); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อเรื่อง..." aria-label="ค้นหาชื่อเรื่อง" /><button type="submit" disabled={loading}>ค้นหา</button></form>
      {error && <div className={styles.error}>{error}</div>}
      {loading && !items.length ? <div className={styles.empty}>กำลังโหลดรายการ...</div> : !filtered.length ? <div className={styles.empty}>ยังไม่มีรายการในหมวดนี้</div> : <section className={styles.grid}>{filtered.map((item) => <BrowseCard key={item.id} item={item} />)}</section>}
      {hasMore && <button className={styles.more} type="button" onClick={() => void load(page + 1, true)} disabled={loadingMore}>{loadingMore ? "กำลังโหลด..." : "แสดงเพิ่มเติม"}</button>}
    </div>
  </main>;
}
