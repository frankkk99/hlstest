"use client";

import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";

type CatalogItem = {
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
  hasPlayer: boolean;
  sourceCount: number;
};

type CatalogResponse = {
  ok: boolean;
  error?: string;
  page?: number;
  limit?: number;
  total?: number;
  items?: CatalogItem[];
};

type SessionResponse = {
  ok: boolean;
  error?: string;
  session?: { sessionId: string; mediaUrl: string; proxyUrl?: string | null; expiresAt: number };
};

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "ไม่ระบุความยาว";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")} ชม.` : `${minutes} นาที`;
}

function titleText(item: CatalogItem) {
  return item.title || item.originalTitle || item.code || "ไม่มีชื่อเรื่อง";
}

function formatYear(date: string | null) {
  return date?.slice(0, 4) || "ไม่ระบุปี";
}

function imageProxyUrl(url: string | null) {
  return url ? `/api/catalog/image?url=${encodeURIComponent(url)}` : undefined;
}

export default function MoviesPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"latest" | "release" | "title">("latest");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [playerMessage, setPlayerMessage] = useState("เลือกการ์ดเพื่อเริ่มเล่น");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const hasMore = items.length < total;
  const passCount = useMemo(() => items.filter((item) => item.playerStatus === "pass").length, [items]);
  const seriesCount = useMemo(() => items.filter((item) => item.isSeries).length, [items]);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, []);

  async function loadCatalog(nextPage = 1, append = false) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "24", sort, ready: "1", curated: "1" });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/catalog?${params.toString()}`, { cache: "default" });
      const data = (await response.json()) as CatalogResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "อ่านรายการหนังไม่สำเร็จ");
      setItems((current) => (append ? [...current, ...(data.items || [])] : data.items || []));
      setTotal(data.total || 0);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "อ่านรายการหนังไม่สำเร็จ");
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadCatalog(1);
    // Search and sort are intentionally handled by the form submit/change action below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetPlayer() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  async function playItem(item: CatalogItem) {
    setSelected(item);
    resetPlayer();
    setPlayerMessage(item.mediaUrl ? "กำลังเปิด manifest ที่บันทึกไว้…" : "กำลังเปิด Chromium session และดึง Player ใหม่…");
    if (!item.playerPageUrl) {
      setPlayerMessage("รายการนี้ยังไม่มีหน้า Player ที่บันทึกไว้");
      return;
    }

    try {
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: item.playerPageUrl,
          mediaUrl: item.mediaUrl || undefined,
          origin: item.origin || undefined,
          referer: item.referer || undefined,
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || "เปิด Player session ไม่สำเร็จ");
      // Prefer the Chromium-backed endpoint. Some providers (notably Cloudflare
      // protected HLS hosts) reject a plain server-side fetch even when the
      // manifest was captured successfully. The signed stateless proxy remains
      // available as a fallback for providers that allow it.
      const browserSessionUrl = `/api/browser-session?session=${encodeURIComponent(data.session.sessionId)}&url=${encodeURIComponent(data.session.mediaUrl)}`;
      const directUrl = data.session.mediaUrl;
      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบ video player");

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        let fallbackStarted = false;
        video.onerror = () => {
          if (fallbackStarted || directUrl === browserSessionUrl) return;
          fallbackStarted = true;
          video.src = browserSessionUrl;
          video.load();
          setPlayerMessage("Direct HLS ถูกบล็อก กำลังสลับไป Chromium session…");
        };
        video.src = directUrl;
        setPlayerMessage(item.mediaUrl ? "กำลังเล่นจาก manifest สดโดยตรง" : "กำลังเปิด Native HLS");
        await video.play().catch(() => undefined);
        return;
      }
      if (!Hls.isSupported()) throw new Error("Browser นี้ไม่รองรับ HLS.js");

      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      hlsRef.current = hls;
      let fallbackStarted = false;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(directUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerMessage(item.mediaUrl ? "Manifest ที่บันทึกไว้ผ่านแล้ว กำลังเล่น" : "Manifest ผ่านแล้ว กำลังเล่น");
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (!fallbackStarted && directUrl !== browserSessionUrl) {
            fallbackStarted = true;
            hls.stopLoad();
            hls.loadSource(browserSessionUrl);
            setPlayerMessage("Direct HLS ถูกบล็อก กำลังสลับไป Chromium session…");
            return;
          }
          setPlayerMessage(`Player error: ${data.details}`);
        }
      });
    } catch (playError) {
      setPlayerMessage(playError instanceof Error ? playError.message : "เปิด Player ไม่สำเร็จ");
    }
  }

  return (
    <main className="shell catalog-page">
      <section className="catalog-hero">
        <div>
          <p className="eyebrow">HLSHUB MOVIE CATALOG</p>
          <h1>หน้าเว็บหนังจากข้อมูลที่ดึงเข้า hlshub</h1>
          <p className="subtitle">
            แสดงการ์ดจากฐานข้อมูลกลาง พร้อมสถานะ Player และเปิดทดสอบแบบ session ใหม่เมื่อกดเล่น
          </p>
        </div>
        <div className="status-chip">Server-side catalog</div>
      </section>

      <form
        className="panel catalog-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void loadCatalog(1);
        }}
      >
        <label className="catalog-search">
          <span>ค้นหาชื่อเรื่อง / รหัส</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="เช่น DLDSS-002" />
        </label>
        <label className="catalog-sort">
          <span>เรียงลำดับ</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="latest">ดึงเข้าล่าสุด</option>
            <option value="release">วันวางจำหน่ายล่าสุด</option>
            <option value="title">ชื่อเรื่อง A–Z</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "กำลังโหลด…" : "ค้นหา"}
        </button>
      </form>

      <section className="catalog-metrics">
        <article className="metric"><span>รายการทั้งหมด</span><strong>{total}</strong><small>จาก hlshub</small></article>
        <article className="metric"><span>แสดงอยู่</span><strong>{items.length}</strong><small>โหลดครั้งละ 24 เรื่อง</small></article>
        <article className="metric"><span>Player PASS</span><strong>{passCount}</strong><small>ในชุดที่แสดง</small></article>
        <article className="metric"><span>Series</span><strong>{seriesCount}</strong><small>ในชุดที่แสดง</small></article>
      </section>

      {error && <div className="alert badbox">{error}</div>}

      {selected && (
        <section className="panel catalog-player-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">PLAYER PREVIEW</p>
              <h2>{titleText(selected)}</h2>
            </div>
            <button className="secondary" type="button" onClick={() => { resetPlayer(); setSelected(null); }}>
              ปิด
            </button>
          </div>
          <video ref={videoRef} className="video catalog-video" controls playsInline poster={selected.coverUrl || undefined} />
          <p className="player-message">{playerMessage}</p>
          <div className="catalog-player-meta">
            <span>{selected.code || "ไม่มีรหัส"}</span>
            <span>{formatDuration(selected.durationSeconds)}</span>
            <span>{selected.playerType?.toUpperCase() || "ไม่ทราบชนิด"}</span>
            <span>{selected.provider || "ไม่ทราบ provider"}</span>
          </div>
        </section>
      )}

      <section className="panel catalog-list-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">DISCOVERED TITLES</p>
            <h2>รายการหนัง</h2>
          </div>
          <span className="catalog-count">{items.length} / {total || 0}</span>
        </div>

        {loading && !items.length ? (
          <div className="catalog-empty"><h2>กำลังโหลดรายการ…</h2><p>กำลังอ่านข้อมูลจาก hlshub</p></div>
        ) : !items.length ? (
          <div className="catalog-empty"><h2>ยังไม่มีรายการให้แสดง</h2><p>{error || "เมื่อเปิด service-role key และเริ่มทดสอบจาก Bulk Player รายการจะถูกบันทึกเข้ามาที่นี่"}</p></div>
        ) : (
          <div className="catalog-grid">
            {items.map((item) => {
              const active = selected?.id === item.id;
              return (
                <button key={item.id} className={`catalog-card ${active ? "selected" : ""}`} type="button" onClick={() => void playItem(item)}>
                  <div className="catalog-cover-wrap">
                    {item.coverUrl ? (
                      <img
                        className="catalog-cover"
                        src={imageProxyUrl(item.coverUrl)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          const image = event.currentTarget;
                          if (image.dataset.fallback !== "1") {
                            image.dataset.fallback = "1";
                            image.src = "/cover-fallback.svg";
                          }
                        }}
                      />
                    ) : <div className="catalog-cover-placeholder">NO COVER</div>}
                  </div>
                  <div className="catalog-card-body">
                    <strong>{titleText(item)}</strong>
                    <span>{formatYear(item.releaseDate)} · {formatDuration(item.durationSeconds)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="catalog-load-more">
            <button className="secondary" type="button" disabled={loadingMore} onClick={() => void loadCatalog(page + 1, true)}>
              {loadingMore ? "กำลังโหลดเพิ่ม…" : "โหลดเพิ่ม"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
