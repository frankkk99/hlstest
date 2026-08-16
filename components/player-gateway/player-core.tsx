"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import {
  clearPreparedAvdbPlayback,
  getPreparedAvdbPlayback,
  prewarmAvdbPlayback,
  requestAvdbPlaybackSession,
  type AvdbPlaybackSession,
} from "@/lib/avdb-prewarm-client";
import styles from "./player-core.module.css";

const FIRST_FRAME_FADE_MS = 200;

type PlayerGatewayPlayerProps = {
  catalogId: string;
  poster?: string | null;
  duration?: string | null;
  showStatus?: boolean;
  className?: string;
};

function loadingMessage(duration?: string | null) {
  const value = duration?.trim();
  return value ? `กำลังเตรียมวิดีโอ (${value})` : "กำลังเตรียมวิดีโอ";
}

export default function PlayerGatewayPlayer({
  catalogId,
  poster = "",
  duration = null,
  showStatus = false,
  className = "",
}: PlayerGatewayPlayerProps) {
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
  const preparedSessionRef = useRef<AvdbPlaybackSession | null>(null);
  const prewarmPromiseRef = useRef<Promise<AvdbPlaybackSession | null> | null>(null);
  const hlsModuleRef = useRef<Promise<typeof import("hls.js")> | null>(null);

  useEffect(() => {
    if (!catalogId) return;
    let active = true;
    preparedSessionRef.current = getPreparedAvdbPlayback(catalogId, 5_000);
    hlsModuleRef.current ??= import("hls.js");

    const promise = prewarmAvdbPlayback(catalogId)
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
  }, [catalogId]);

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

    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
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
    if (!catalogId || (starting && attempt === 0)) return;
    const run = ++runRef.current;
    resetFirstFrameTransition();
    setRequested(true);
    setStarted(false);
    setStarting(true);
    setMessage(attempt ? "กำลังลองเชื่อมต่ออีกครั้ง" : loadingMessage(duration));
    stopVideo();

    try {
      let session: AvdbPlaybackSession | null = null;
      if (attempt === 0) {
        const prepared = preparedSessionRef.current || getPreparedAvdbPlayback(catalogId, 5_000);
        if (prepared && prepared.expiresAt > Date.now() + 5_000) session = prepared;
        else if (prewarmPromiseRef.current) session = await prewarmPromiseRef.current;
      }
      session ??= await requestAvdbPlaybackSession(catalogId, attempt > 0);
      if (runRef.current !== run) return;
      preparedSessionRef.current = session;

      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบเครื่องเล่นวิดีโอ");

      const retry = () => {
        if (runRef.current !== run) return;
        preparedSessionRef.current = null;
        clearPreparedAvdbPlayback(catalogId);
        if (attempt < 1) void startPlayback(attempt + 1);
        else {
          resetFirstFrameTransition();
          setStarting(false);
          setRequested(false);
          setMessage("Player ยังไม่พร้อม ลองใหม่อีกครั้ง");
        }
      };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.onerror = retry;
        video.src = session.playbackUrl;
        video.load();
        await video.play().catch(() => undefined);
        setMessage("กำลังเตรียมภาพวิดีโอ");
      } else {
        const hlsModule = await (hlsModuleRef.current ??= import("hls.js"));
        const HlsPlayer = hlsModule.default;
        if (!HlsPlayer.isSupported()) throw new Error("อุปกรณ์นี้ยังไม่รองรับการเล่นวิดีโอ");
        const hls = new HlsPlayer({
          enableWorker: true,
          maxBufferLength: 20,
          capLevelToPlayerSize: true,
          startLevel: -1,
        });
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, details) => { if (details.fatal) retry(); });
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          setMessage("กำลังเตรียมภาพวิดีโอ");
          void video.play().catch(() => undefined);
        });
        hls.attachMedia(video);
        hls.loadSource(session.playbackUrl);
      }
    } catch (error) {
      preparedSessionRef.current = null;
      clearPreparedAvdbPlayback(catalogId);
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

  const waitingForFirstFrame = requested && !started;
  const posterValue = poster || "";

  return (
    <div className={`${styles.gatewayPlayer} ${className}`.trim()}>
      <section className={styles.playerFrame}>
        <video
          ref={videoRef}
          className={`${styles.videoSurface} ${requested && posterValue && !firstFrameReady ? styles.videoWaiting : styles.videoReady}`}
          controls
          playsInline
          poster={posterValue || undefined}
          onPlay={() => setMessage("กำลังเตรียมภาพวิดีโอ")}
          onPlaying={revealFirstVideoFrame}
        />

        {waitingForFirstFrame && posterValue ? (
          <div className={`${styles.loadingPoster} ${firstFrameReady ? styles.loadingPosterFade : ""}`} aria-hidden="true">
            <img src={posterValue} alt="" />
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
            <div className={styles.progressTrack} aria-label="กำลังโหลดวิดีโอ"><span className={styles.progressBar} /></div>
          </div>
        ) : null}
      </section>

      {showStatus ? <p className={styles.status}>{starting ? loadingMessage(duration) : message}</p> : null}
    </div>
  );
}
