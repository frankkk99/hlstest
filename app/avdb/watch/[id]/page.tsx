"use client";

import type Hls from "hls.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearPreparedAvdbPlayback,
  getPreparedAvdbPlayback,
  prewarmAvdbPlayback,
  requestAvdbPlaybackSession,
  type AvdbPlaybackSession,
} from "@/lib/avdb-prewarm-client";
import SourceSwitcher from "../../../source-switcher";
import ExpandableText from "../../expandable-text";
import ui from "../../ui-polish.module.css";
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
type PlaybackSession = AvdbPlaybackSession;

const FIRST_FRAME_FADE_MS = 420;

function videoLoadingMessage(duration: string | null | undefined) {
  const value = duration?.trim();
  const durationLabel = value ? ` (ความยาว ${value})` : "";
  return `กำลังโหลดวิดีโอ${durationLabel} อาจใช้เวลาสักครู่ ขึ้นอยู่กับความเร็วอินเทอร์เน็ต`;
}

function WatchSkeleton() {
  return (
    <main className={ui.pageSkeleton} aria-label="กำลังโหลดหน้าดู AVDB">
      <div className={ui.skeletonShell}>
        <div className={`${ui.skeletonHero} ${ui.watchSkeletonPlayer}`} />
        <div className={ui.watchSkeletonInfo}>
          <span className={ui.skeletonLine} />
          <span className={ui.skeletonLine} />
          <span className={ui.skeletonLine} />
        </div>
        <div className={ui.skeletonGrid}>
          {Array.from({ length: 4 }, (_, index) => (
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

export default function AvdbWatchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [related, setRelated] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [requested, setRequested] = useState(false);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [message, setMessage] = useState("กดปุ่มเล่นเพื่อเริ่มรับชม");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const runRef = useRef(0);
  const frameTransitionRef = useRef(0);
  const frameRequestPendingRef = useRef(false);
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
    preparedSessionRef.current = getPreparedAvdbPlayback(item.id, 5_000);
    hlsModuleRef.current ??= import("hls.js");

    const promise = prewarmAvdbPlayback(item.id)
      .then((session) => {
        if (active && session) preparedSessionRef.current = session;
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
    frameTransitionRef.current += 1;
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  function resetFirstFrameTransition() {
    frameTransitionRef.current += 1;
    frameRequestPendingRef.current = false;
    setFirstFrameReady(false);
  }

  function revealFirstVideoFrame() {
    const video = videoRef.current;
    if (!video || frameRequestPendingRef.current) return;

    frameRequestPendingRef.current = true;
    const transitionToken = frameTransitionRef.current;
    const finish = () => {
      if (transitionToken !== frameTransitionRef.current) return;
      setFirstFrameReady(true);
      setStarting(false);
      setMessage("กำลังรับชม");
      window.setTimeout(() => {
        if (transitionToken !== frameTransitionRef.current) return;
        setStarted(true);
      }, FIRST_FRAME_FADE_MS);
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => finish());
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish);
    });
  }

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
    resetFirstFrameTransition();
    setRequested(true);
    setStarted(false);
    setStarting(true);
    setMessage(attempt ? "กำลังลองเชื่อมต่อให้อีกครั้ง..." : videoLoadingMessage(item.duration));
    stopVideo();

    try {
      let session: PlaybackSession | null = null;
      if (attempt === 0) {
        const prepared = preparedSessionRef.current || getPreparedAvdbPlayback(item.id, 5_000);
        if (prepared && prepared.expiresAt > Date.now() + 5_000) session = prepared;
        else if (prewarmPromiseRef.current) session = await prewarmPromiseRef.current;
      }
      session ??= await requestAvdbPlaybackSession(item.id, attempt > 0);
      if (runRef.current !== run) return;
      preparedSessionRef.current = session;

      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบเครื่องเล่นวิดีโอ");

      const retry = () => {
        if (runRef.current !== run) return;
        preparedSessionRef.current = null;
        clearPreparedAvdbPlayback(item.id);
        if (attempt < 1) void startPlayback(attempt + 1);
        else {
          resetFirstFrameTransition();
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
        setMessage("กำลังเตรียมภาพวิดีโอ...");
      } else {
        const hlsModule = await (hlsModuleRef.current ??= import("hls.js"));
        const HlsPlayer = hlsModule.default;
        if (!HlsPlayer.isSupported()) throw new Error("อุปกรณ์นี้ยังไม่รองรับการเล่นวิดีโอ");
        const hls = new HlsPlayer({ enableWorker: true, maxBufferLength: 20, capLevelToPlayerSize: true, startLevel: -1 });
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, details) => { if (details.fatal) retry(); });
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          setMessage("กำลังเตรียมภาพวิดีโอ...");
          void video.play().catch(() => undefined);
        });
        hls.attachMedia(video);
        hls.loadSource(session.playbackUrl);
      }
    } catch (error) {
      preparedSessionRef.current = null;
      clearPreparedAvdbPlayback(item.id);
      if (attempt < 1) {
        void startPlayback(attempt + 1);
        return;
      }
      resetFirstFrameTransition();
      setRequested(false);
      setMessage(error instanceof Error ? error.message : "ยังเปิดวิดีโอไม่ได้");
    } finally {
      if (runRef.current === run && !frameRequestPendingRef.current) setStarting(false);
    }
  }

  if (loading) return <WatchSkeleton />;

  if (!item) return <main className={styles.page}><div className={styles.empty}><div className={styles.emptyBox}><strong>ไม่พบรายการนี้</strong><p>{message}</p><Link href="/avdb">กลับหน้าแรก</Link></div></div></main>;

  const poster = item.thumb_url || item.poster_url || "";
  const code = item.movie_code || item.external_id || "AVDB";
  const loadingMessage = videoLoadingMessage(item.duration);
  const waitingForFirstFrame = requested && !started;

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
            className={`${styles.videoSurface} ${requested && poster && !firstFrameReady ? styles.videoWaiting : styles.videoReady}`}
            controls
            playsInline
            poster={poster || undefined}
            onPlay={() => { setMessage("กำลังเตรียมภาพวิดีโอ..."); }}
            onPlaying={revealFirstVideoFrame}
          />
          {waitingForFirstFrame && poster ? (
            <div className={`${styles.loadingPoster} ${firstFrameReady ? styles.loadingPosterFade : ""}`} aria-hidden="true">
              <img src={poster} alt="" />
            </div>
          ) : null}
          {!requested && !started && !starting ? <div className={styles.posterShade} /> : null}
          {!requested && !started && !starting ? (
            <div className={styles.playOverlay}>
              <button className={styles.playButton} type="button" onClick={() => void startPlayback()} aria-label="เริ่มรับชม">▶</button>
            </div>
          ) : null}
          {waitingForFirstFrame ? (
            <div className={`${styles.loadingOverlay} ${firstFrameReady ? styles.loadingOverlayFade : ""}`} role="status" aria-live="polite">
              <span className={styles.loadingText}>{loadingMessage}</span>
              <div className={styles.progressTrack} aria-label="กำลังโหลดวิดีโอ"><span className={styles.progressBar} /></div>
            </div>
          ) : null}
        </section>

        <section className={styles.watchInfo}>
          <div className={styles.infoMain}>
            <p className={styles.code}>{code}</p>
            <ExpandableText as="h1" lines={3} text={item.title} className={styles.title} />
            {item.original_title && item.original_title !== item.title ? <ExpandableText as="p" lines={3} text={item.original_title} className={styles.original} /> : null}
            <div className={styles.meta}>
              {item.year ? <span>{item.year}</span> : null}
              {item.quality ? <span>{item.quality}</span> : null}
              {item.duration ? <span>{item.duration}</span> : null}
            </div>
            {item.description ? <ExpandableText as="p" lines={3} text={item.description} className={styles.description} /> : null}
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
                  <div className={styles.cardBody}><strong className={ui.cardTitle3}>{entry.title}</strong><span>{entry.movie_code || entry.duration || "AVDB"}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
