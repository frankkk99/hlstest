"use client";

import type Hls from "hls.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SourceSwitcher from "../../../source-switcher";
import styles from "./watch.module.css";

type CatalogItem = {
  id: string;
  stage_item_id: string;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  description: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_provider: string | null;
  published_at: string;
};

type DetailResponse = { ok: boolean; error?: string; item?: CatalogItem };
type CatalogResponse = { ok: boolean; items?: CatalogItem[] };
type PlaybackSession = { playbackUrl: string; expiresAt: number; provider: string | null };
type SessionResponse = { ok: boolean; error?: string; failureType?: string; session?: PlaybackSession };

function videoLoadingMessage(duration: string | null | undefined) {
  const value = duration?.trim();
  const durationLabel = value ? ` (ความยาว ${value})` : "";
  return `กำลังโหลดวิดีโอ${durationLabel} อาจใช้เวลาสักครู่ ขึ้นอยู่กับความเร็วอินเทอร์เน็ต`;
}

async function requestPlaybackSession(catalogId: string, forceFresh = false) {
  const response = await fetch("/api/avdb/playback/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalogId, forceFresh }),
    cache: "no-store",
  });
  const payload = (await response.json()) as SessionResponse;
  if (!response.ok || !payload.ok || !payload.session) throw new Error(payload.error || "ยังเปิดวิดีโอไม่ได้");
  return payload.session;
}

export default function AvdbWatchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [related, setRelated] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState("กดปุ่มเล่นเพื่อเริ่มรับชม");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const runRef = useRef(0);
  const preparedSessionRef = useRef<PlaybackSession | null>(null);
  const prewarmPromiseRef = useRef<Promise<PlaybackSession | null> | null>(null);
  const hlsModuleRef = useRef<Promise<typeof import("hls.js")> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [detailResponse, relatedResponse] = await Promise.all([
          fetch(`/api/avdb/catalog/${encodeURIComponent(id)}`, { cache: "no-store" }),
          fetch("/api/avdb/catalog?limit=8", { cache: "no-store" }),
        ]);
        const detail = (await detailResponse.json()) as DetailResponse;
        const catalog = (await relatedResponse.json()) as CatalogResponse;
        if (!detailResponse.ok || !detail.ok || !detail.item) throw new Error(detail.error || "ไม่พบรายการนี้");
        if (!active) return;
        setItem(detail.item);
        setRelated((catalog.items || []).filter((entry) => entry.id !== detail.item?.id).slice(0, 6));
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "เปิดรายการนี้ไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!item?.id) return;
    let active = true;
    preparedSessionRef.current = null;
    hlsModuleRef.current ??= import("hls.js");

    const promise = requestPlaybackSession(item.id)
      .then((session) => {
        if (active) preparedSessionRef.current = session;
        return active ? session : null;
      })
      .catch(() => null)
      .finally(() => {
        if (prewarmPromiseRef.current === promise) prewarmPromiseRef.current = null;
      });

    prewarmPromiseRef.current = promise;
    return () => {
      active = false;
      if (prewarmPromiseRef.current === promise) prewarmPromiseRef.current = null;
      preparedSessionRef.current = null;
    };
  }, [item]);

  useEffect(() => () => {
    runRef.current += 1;
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  function stopVideo() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  async function startPlayback(attempt = 0) {
    if (!item || (starting && attempt === 0)) return;
    const run = ++runRef.current;
    setRequested(true);
    setStarting(true);
    setMessage(attempt ? "กำลังลองเชื่อมต่อให้อีกครั้ง..." : videoLoadingMessage(item.duration));
    stopVideo();

    try {
      let session: PlaybackSession | null = null;
      if (attempt === 0) {
        const prepared = preparedSessionRef.current;
        if (prepared && prepared.expiresAt > Date.now() + 5000) session = prepared;
        else if (prewarmPromiseRef.current) session = await prewarmPromiseRef.current;
      }
      session ??= await requestPlaybackSession(item.id, attempt > 0);
      if (runRef.current !== run) return;
      preparedSessionRef.current = session;

      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบเครื่องเล่นวิดีโอ");

      const retry = () => {
        if (runRef.current !== run) return;
        preparedSessionRef.current = null;
        if (attempt < 1) void startPlayback(attempt + 1);
        else {
          setStarting(false);
          setRequested(false);
          setMessage("วิดีโอเรื่องนี้ยังไม่พร้อม ลองใหม่อีกครั้งภายหลัง");
        }
      };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.onerror = retry;
        video.src = session.playbackUrl;
        video.load();
        await video.play().catch(() => undefined);
        setMessage("พร้อมรับชม");
      } else {
        const hlsModule = await (hlsModuleRef.current ??= import("hls.js"));
        const HlsPlayer = hlsModule.default;
        if (!HlsPlayer.isSupported()) throw new Error("อุปกรณ์นี้ยังไม่รองรับการเล่นวิดีโอ");
        const hls = new HlsPlayer({ enableWorker: true, maxBufferLength: 20, capLevelToPlayerSize: true, startLevel: -1 });
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, details) => { if (details.fatal) retry(); });
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          setMessage("พร้อมรับชม");
          void video.play().catch(() => undefined);
        });
        hls.attachMedia(video);
        hls.loadSource(session.playbackUrl);
      }
    } catch (error) {
      preparedSessionRef.current = null;
      if (attempt < 1) {
        void startPlayback(attempt + 1);
        return;
      }
      setRequested(false);
      setMessage(error instanceof Error ? error.message : "ยังเปิดวิดีโอไม่ได้");
    } finally {
      if (runRef.current === run) setStarting(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.empty}><div className={styles.emptyBox}><strong>AVDB INDEX</strong><p>กำลังโหลดรายการ…</p></div></div></main>;

  if (!item) return <main className={styles.page}><div className={styles.empty}><div className={styles.emptyBox}><strong>ไม่พบรายการนี้</strong><p>{message}</p><Link href="/avdb">กลับหน้าแรก</Link></div></div></main>;

  const poster = item.poster_url || item.thumb_url || "";
  const code = item.movie_code || item.external_id || "AVDB";
  const loadingMessage = videoLoadingMessage(item.duration);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <Link href="/avdb" className={styles.back}>← กลับหน้าแรก</Link>
        <SourceSwitcher current="avdb" />
      </header>

      <div className={styles.shell}>
        <section className={styles.playerFrame}>
          <video
            ref={videoRef}
            controls
            playsInline
            poster={poster || undefined}
            onPlay={() => { setStarted(true); setStarting(false); setMessage("กำลังรับชม"); }}
            onPlaying={() => { setStarted(true); setStarting(false); setMessage("กำลังรับชม"); }}
          />
          {!requested && !started && !starting ? <div className={styles.posterShade} /> : null}
          {!requested && !started && !starting ? (
            <div className={styles.playOverlay}>
              <button className={styles.playButton} type="button" onClick={() => void startPlayback()} aria-label="เริ่มรับชม">▶</button>
            </div>
          ) : null}
          {requested && !started ? (
            <div className={styles.loadingOverlay} role="status" aria-live="polite">
              <span className={styles.loadingText}>{loadingMessage}</span>
              <div className={styles.progressTrack} aria-label="กำลังโหลดวิดีโอ"><span className={styles.progressBar} /></div>
            </div>
          ) : null}
        </section>

        <section className={styles.watchInfo}>
          <div className={styles.infoMain}>
            <p className={styles.code}>{code}</p>
            <h1 className={styles.title}>{item.title}</h1>
            {item.original_title && item.original_title !== item.title ? <p className={styles.original}>{item.original_title}</p> : null}
            <div className={styles.meta}>
              {item.year ? <span>{item.year}</span> : null}
              {item.quality ? <span>{item.quality}</span> : null}
              {item.duration ? <span>{item.duration}</span> : null}
            </div>
            {item.description ? <p className={styles.description}>{item.description}</p> : null}
          </div>
          <p className={styles.playbackMessage}>{starting ? loadingMessage : message}</p>
        </section>

        {related.length ? (
          <section className={styles.related}>
            <div className={styles.sectionHead}><h2>เรื่องอื่นที่น่าสนใจ</h2><span>เลือกดูต่อ</span></div>
            <div className={styles.grid}>
              {related.map((entry) => (
                <Link className={styles.card} href={`/avdb/watch/${entry.id}`} key={entry.id}>
                  <div className={styles.cover}>{entry.thumb_url || entry.poster_url ? <img src={entry.thumb_url || entry.poster_url || ""} alt="" loading="lazy" /> : null}</div>
                  <div className={styles.cardBody}><strong>{entry.title}</strong><span>{entry.movie_code || entry.duration || "AVDB"}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
