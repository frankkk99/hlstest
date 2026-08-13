"use client";

import type Hls from "hls.js";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "../../hub.module.css";
import { WatchSkeleton } from "../../skeletons";
import { displayTitle, durationLabel, imageUrl, yearLabel, type StorefrontDetail, type StorefrontItem } from "../../storefront";

type DetailResponse = { ok: boolean; error?: string; item?: StorefrontDetail };
type SessionResponse = { ok: boolean; error?: string; session?: { sessionId: string; mediaUrl: string; proxyUrl?: string | null; expiresAt: number } };

function videoLoadingMessage(durationSeconds: number | null | undefined) {
  const duration = durationSeconds && durationSeconds > 0 ? ` (ความยาว ${durationLabel(durationSeconds)})` : "";
  return `กำลังโหลดวิดีโอ${duration} อาจใช้เวลาสักครู่ ขึ้นอยู่กับความเร็วอินเทอร์เน็ต`;
}

export default function StorefrontWatchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<StorefrontDetail | null>(null);
  const [related, setRelated] = useState<StorefrontItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const [message, setMessage] = useState("กดปุ่มเล่นเพื่อเริ่มรับชม");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playbackRunRef = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [detailResponse, catalogResponse] = await Promise.all([
          fetch(`/api/catalog/${id}`, { cache: "default" }),
          fetch("/api/catalog?limit=12&sort=latest&ready=1", { cache: "default" }),
        ]);
        const detail = (await detailResponse.json()) as DetailResponse;
        const catalog = (await catalogResponse.json()) as { items?: StorefrontItem[] };
        if (!detailResponse.ok || !detail.ok || !detail.item) throw new Error(detail.error || "ไม่พบเรื่องนี้");
        if (active) {
          setItem(detail.item);
          setRelated((catalog.items || []).filter((entry) => entry.id !== detail.item?.id && entry.hasPlayer).slice(0, 6));
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "ไม่สามารถเปิดเรื่องนี้ได้");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  useEffect(() => () => {
    playbackRunRef.current += 1;
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  function stopVideo() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  }

  async function startPlayback(attempt = 0) {
    if (!item?.playerPageUrl || (starting && attempt === 0)) return;
    const run = ++playbackRunRef.current;
    setPlayRequested(true);
    setStarting(true);
    stopVideo();
    setMessage(attempt ? "กำลังลองเชื่อมต่อให้อีกครั้ง..." : videoLoadingMessage(item.durationSeconds));
    try {
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: item.playerPageUrl, mediaUrl: item.mediaUrl || undefined, origin: item.origin || undefined, referer: item.referer || undefined }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || "ยังเปิดวิดีโอไม่ได้");
      const sessionUrl = `/api/browser-session?session=${encodeURIComponent(data.session.sessionId)}&url=${encodeURIComponent(data.session.mediaUrl)}`;
      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบเครื่องเล่นวิดีโอ");
      const retry = () => {
        if (playbackRunRef.current !== run) return;
        if (attempt < 1) void startPlayback(attempt + 1);
        else setMessage("วิดีโอเรื่องนี้ยังไม่พร้อม ลองใหม่อีกครั้งภายหลัง");
      };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.onerror = retry;
        video.src = sessionUrl;
        video.load();
        await video.play().catch(() => undefined);
        setMessage("พร้อมรับชม");
      } else {
        const hlsModule = await import("hls.js");
        const HlsPlayer = hlsModule.default;
        if (!HlsPlayer.isSupported()) throw new Error("อุปกรณ์นี้ยังไม่รองรับการเล่นวิดีโอ");
        const hls = new HlsPlayer({ enableWorker: true, maxBufferLength: 20, capLevelToPlayerSize: true, startLevel: -1 });
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, details) => { if (details.fatal) retry(); });
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => { setMessage("พร้อมรับชม"); void video.play().catch(() => undefined); });
        hls.loadSource(sessionUrl);
        hls.attachMedia(video);
      }
    } catch (error) {
      if (attempt < 1) { void startPlayback(attempt + 1); return; }
      setPlayRequested(false);
      setMessage(error instanceof Error ? error.message : "ยังเปิดวิดีโอไม่ได้");
    } finally {
      if (playbackRunRef.current === run) setStarting(false);
    }
  }

  if (loading) return <WatchSkeleton />;
  if (!item) return <main className={styles.watch}><div className={styles.container}><div className={styles.error}>{message}</div><Link className={styles.back} href="/hub">← กลับหน้าแรก</Link></div></main>;

  return <main className={styles.watch}>
    <div className={styles.container}>
      <section className={styles.watchPlayer}>
        <video
          ref={videoRef}
          controls
          playsInline
          poster={imageUrl(item.coverUrl)}
          aria-label={displayTitle(item)}
          onPlay={() => {
            setHasStarted(true);
            setStarting(false);
            setMessage("กำลังรับชม");
          }}
          onPlaying={() => {
            setHasStarted(true);
            setStarting(false);
            setMessage("กำลังรับชม");
          }}
        />
        {!playRequested && !hasStarted && !starting && <div className={styles.playOverlay}><button className={styles.playButton} type="button" onClick={() => void startPlayback()} aria-label="เริ่มเล่น">▶</button></div>}
        {playRequested && !hasStarted && <div className={styles.watchLoading} role="status" aria-live="polite"><span>{videoLoadingMessage(item.durationSeconds)}</span><div className={styles.watchProgressTrack} aria-label="กำลังโหลดวิดีโอ"><span className={styles.watchProgressBar} /></div></div>}
      </section>
      <section className={styles.watchInfo}><div><h1 className={styles.watchTitle}>{displayTitle(item)}</h1><div className={styles.heroMeta}><span>{yearLabel(item.releaseDate)}</span><span>{durationLabel(item.durationSeconds)}</span><span>{item.isSeries ? "ซีรีส์" : "ภาพยนตร์"}</span></div><p className={styles.watchDescription}>{item.synopsis || "ขอให้สนุกกับการรับชม"}</p></div><p className={styles.watchMessage}>{starting ? videoLoadingMessage(item.durationSeconds) : message}</p></section>
      {!!related.length && <section className={styles.related}><div className={styles.rowHeader}><h2>เรื่องที่น่าสนใจ</h2><span>แนะนำสำหรับคุณ</span></div><div className={styles.cardGrid}>{related.map((entry) => <Link key={entry.id} className={styles.card} href={`/hub/watch/${entry.id}`}><div className={styles.cover}><Image src={imageUrl(entry.coverUrl)} alt={displayTitle(entry)} fill unoptimized sizes="16vw" onError={(event) => { event.currentTarget.src = "/cover-fallback.svg"; }} /><span className={styles.coverShade} /></div><div className={styles.cardBody}><strong className={styles.cardTitle}>{displayTitle(entry)}</strong><div className={styles.cardMeta}><span>{yearLabel(entry.releaseDate)}</span><span>{durationLabel(entry.durationSeconds)}</span></div></div></Link>)}</div></section>}
    </div>
  </main>;
}
