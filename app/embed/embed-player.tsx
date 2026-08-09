"use client";

import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  url: string;
  origin: string;
  referer: string;
  userAgent: string;
  autoplay: boolean;
};

export default function EmbedPlayer({ url, origin, referer, userAgent, autoplay }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [message, setMessage] = useState("พร้อมเล่น");

  const source = useMemo(() => {
    const params = new URLSearchParams({ url });
    if (origin) params.set("origin", origin);
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    return `/api/stream?${params.toString()}`;
  }, [url, origin, referer, userAgent]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    setMessage("กำลังโหลด…");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      setMessage("native HLS");
      if (autoplay) void video.play().catch(() => setMessage("กด Play เพื่อเริ่ม"));
      return;
    }

    if (!Hls.isSupported()) {
      setMessage("Browser นี้ไม่รองรับ HLS");
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
    });

    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setMessage("พร้อมเล่น");
      if (autoplay) void video.play().catch(() => setMessage("กด Play เพื่อเริ่ม"));
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setMessage(`Player error: ${data.details}`);
    });

    return () => {
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [url, source, autoplay]);

  if (!url) {
    return <div className="embed-error">Missing media URL</div>;
  }

  return (
    <main className="embed-shell">
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay={autoplay}
        className="embed-video"
      />
      <div className="embed-status">{message}</div>
    </main>
  );
}
