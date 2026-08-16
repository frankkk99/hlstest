"use client";

import Hls from "hls.js";
import { FormEvent, useMemo, useRef, useState } from "react";

type ProbeResult = {
  ok: boolean;
  error?: string;
  proxyEnabled?: boolean;
  serverNote?: string;
  manifest?: {
    finalUrl: string;
    status: number;
    statusText: string;
    contentType: string;
    elapsedMs: number;
    isHls: boolean;
    bytes: number;
    extinfCount?: number;
    variantCount?: number;
    preview?: string;
  };
  segmentTest?: {
    status?: number;
    ok?: boolean;
    contentType?: string | null;
    bytesReceived?: number;
    elapsedMs?: number;
    error?: string;
  } | null;
};

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export default function HlsDiagnosticPage() {
  const [url, setUrl] = useState("");
  const [origin, setOrigin] = useState("https://upload18.org");
  const [referer, setReferer] = useState("https://upload18.org/");
  const [userAgent, setUserAgent] = useState(DEFAULT_UA);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [playerMessage, setPlayerMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const proxyUrl = useMemo(() => {
    if (!url) return "";
    const params = new URLSearchParams({ url });
    if (origin) params.set("origin", origin);
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    return `/api/stream?${params.toString()}`;
  }, [url, origin, referer, userAgent]);

  async function probe(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    setPlayerMessage("");
    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, origin, referer, userAgent, testSegment: true }),
      });
      setResult((await response.json()) as ProbeResult);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  function playPreview() {
    const video = videoRef.current;
    if (!video || !proxyUrl) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setPlayerMessage("กำลังโหลด preview…");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = proxyUrl;
      void video.play().catch(() => undefined);
      return;
    }

    if (!Hls.isSupported()) {
      setPlayerMessage("Browser นี้ไม่รองรับ HLS.js");
      return;
    }

    const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(proxyUrl));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setPlayerMessage("พร้อมเล่น");
      void video.play().catch(() => undefined);
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setPlayerMessage(`Player error: ${data.details}`);
    });
  }

  const manifest = result?.manifest;
  const segment = result?.segmentTest;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">HLS DIAGNOSTIC LAB</p>
          <h1>ตรวจ HLS แบบมี Origin / Referer</h1>
          <p className="subtitle">เครื่องมือเดิมถูกย้ายจากหน้า / มาไว้ที่ /hls-test เพื่อเปิดทางให้หน้าเลือก AVDBAPI / MISSAV</p>
        </div>
        <div className="status-chip">Server-side probe</div>
      </section>

      <form className="panel form" onSubmit={probe}>
        <label className="field full">
          <span>Manifest / Media URL</span>
          <textarea value={url} onChange={(event) => setUrl(event.target.value.trim())} rows={4} spellCheck={false} placeholder="https://example.com/master.m3u8" />
        </label>
        <label className="field"><span>Origin</span><input value={origin} onChange={(event) => setOrigin(event.target.value)} /></label>
        <label className="field"><span>Referer</span><input value={referer} onChange={(event) => setReferer(event.target.value)} /></label>
        <label className="field full"><span>User-Agent</span><input value={userAgent} onChange={(event) => setUserAgent(event.target.value)} /></label>
        <div className="actions full">
          <button className="primary" type="submit" disabled={!url || loading}>{loading ? "กำลังทดสอบ…" : "ทดสอบ Manifest + Segment"}</button>
          <button className="secondary" type="button" onClick={() => { setUrl(""); setResult(null); setPlayerMessage(""); }}>ล้างค่า</button>
        </div>
      </form>

      {result?.error && <div className="alert badbox">{result.error}</div>}

      {manifest && (
        <>
          <section className="summary-grid">
            <article className="metric"><span>Manifest</span><strong>{manifest.status}</strong><small>{manifest.statusText}</small></article>
            <article className="metric"><span>HLS</span><strong>{manifest.isHls ? "PASS" : "FAIL"}</strong><small>{manifest.contentType || "unknown"}</small></article>
            <article className="metric"><span>First segment</span><strong>{segment?.ok ? "PASS" : "FAIL"}</strong><small>{segment?.status ?? "-"}</small></article>
            <article className="metric"><span>Latency</span><strong>{manifest.elapsedMs}</strong><small>ms</small></article>
          </section>

          <section className="panel diagnostics">
            <div className="panel-title"><div><p className="eyebrow">DIAGNOSTICS</p><h2>ผลตรวจ</h2></div></div>
            <div className="kv-grid">
              <div><span>Content-Type</span><b>{manifest.contentType || "-"}</b></div>
              <div><span>Manifest size</span><b>{manifest.bytes.toLocaleString()} bytes</b></div>
              <div><span>Segments</span><b>{manifest.extinfCount ?? 0}</b></div>
              <div><span>Variants</span><b>{manifest.variantCount ?? 0}</b></div>
              <div><span>Segment bytes</span><b>{segment?.bytesReceived ?? 0}</b></div>
              <div><span>Segment latency</span><b>{segment?.elapsedMs ?? 0} ms</b></div>
            </div>
            {segment?.error && <div className="alert badbox">{segment.error}</div>}
            <details open><summary>Manifest preview</summary><pre>{manifest.preview || "-"}</pre></details>
          </section>

          <section className="panel player-panel">
            <div className="panel-title"><div><p className="eyebrow">OPTIONAL PREVIEW</p><h2>ทดลองเล่นผ่าน local proxy</h2></div></div>
            <video ref={videoRef} controls playsInline className="video" />
            <div className="actions">
              <button className="primary" type="button" disabled={!result?.proxyEnabled || !result?.ok} onClick={playPreview}>เล่น Preview</button>
              <span className="player-message">{playerMessage}</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
