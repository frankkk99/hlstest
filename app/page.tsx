"use client";

import Hls from "hls.js";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ProbeResult = {
  ok: boolean;
  error?: string;
  proxyEnabled?: boolean;
  serverNote?: string;
  manifest?: {
    requestedUrl: string;
    finalUrl: string;
    status: number;
    statusText: string;
    contentType: string;
    contentLength: string | null;
    allowOrigin: string | null;
    requestId: string | null;
    u18Cache: string | null;
    u18Guard: string | null;
    elapsedMs: number;
    isHls: boolean;
    bytes: number;
    extinfCount?: number;
    variantCount?: number;
    targetDuration?: string | null;
    playlistType?: string | null;
    canary?: string | null;
    hasEndList?: boolean;
    encrypted?: boolean;
    preview?: string;
    expiry?: {
      unix: number;
      iso: string;
      expired: boolean;
      secondsRemaining: number;
    } | null;
    bindingHints?: {
      ip: boolean;
      browser: boolean;
      signature: boolean;
      session: boolean;
    };
  };
  segmentTest?: {
    url?: string;
    status?: number;
    ok?: boolean;
    contentType?: string | null;
    contentRange?: string | null;
    requestId?: string | null;
    u18Cache?: string | null;
    u18Guard?: string | null;
    bytesReceived?: number;
    elapsedMs?: number;
    error?: string;
  } | null;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

function formatRemaining(seconds: number) {
  if (seconds <= 0) return "หมดอายุแล้ว";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours ? `${hours}ชม.` : "", minutes ? `${minutes}น.` : "", `${secs}วิ.`]
    .filter(Boolean)
    .join(" ");
}

function badge(ok: boolean | undefined, yes = "PASS", no = "FAIL") {
  return <span className={`badge ${ok ? "good" : "bad"}`}>{ok ? yes : no}</span>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [origin, setOrigin] = useState("https://upload18.org");
  const [referer, setReferer] = useState("https://upload18.org/");
  const [userAgent, setUserAgent] = useState(DEFAULT_UA);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [playerMessage, setPlayerMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, []);

  const proxyUrl = useMemo(() => {
    if (!url) return "";
    const params = new URLSearchParams({ url });
    if (origin) params.set("origin", origin);
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    return `/api/stream?${params.toString()}`;
  }, [url, origin, referer, userAgent]);

  async function probe(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setPlayerMessage("");
    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, origin, referer, userAgent, testSegment: true }),
      });
      const data = (await response.json()) as ProbeResult;
      setResult(data);
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
      setPlayerMessage("ใช้ native HLS");
      return;
    }

    if (!Hls.isSupported()) {
      setPlayerMessage("Browser นี้ไม่รองรับ HLS.js");
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
    });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(proxyUrl));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setPlayerMessage("Manifest ผ่านแล้ว กำลังเล่น");
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
          <p className="subtitle">
            ตรวจ manifest, signed URL, CORS, expiry และ segment แรก โดยไม่ต้องเปิด DevTools ของเว็บต้นทาง
          </p>
        </div>
        <div className="status-chip">Server-side probe</div>
      </section>

      <form className="panel form" onSubmit={probe}>
        <label className="field full">
          <span>Manifest / Media URL</span>
          <textarea
            value={url}
            onChange={(event) => setUrl(event.target.value.trim())}
            placeholder="https://example.com/m/..."
            rows={4}
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Origin</span>
          <input value={origin} onChange={(event) => setOrigin(event.target.value)} />
        </label>
        <label className="field">
          <span>Referer</span>
          <input value={referer} onChange={(event) => setReferer(event.target.value)} />
        </label>
        <label className="field full">
          <span>User-Agent</span>
          <input value={userAgent} onChange={(event) => setUserAgent(event.target.value)} />
        </label>

        <div className="actions full">
          <button className="primary" type="submit" disabled={!url || loading}>
            {loading ? "กำลังทดสอบ…" : "ทดสอบ Manifest + Segment"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setUrl("");
              setResult(null);
              setPlayerMessage("");
            }}
          >
            ล้างค่า
          </button>
        </div>
      </form>

      {result?.error && <div className="alert badbox">{result.error}</div>}

      {manifest && (
        <>
          <section className="summary-grid">
            <article className="metric">
              <span>Manifest</span>
              <strong>{badge(result.ok)}</strong>
              <small>{manifest.status} {manifest.statusText}</small>
            </article>
            <article className="metric">
              <span>HLS</span>
              <strong>{badge(manifest.isHls)}</strong>
              <small>{manifest.contentType || "unknown type"}</small>
            </article>
            <article className="metric">
              <span>First segment</span>
              <strong>{badge(segment?.ok)}</strong>
              <small>{segment?.status ?? "ไม่ได้ทดสอบ"}</small>
            </article>
            <article className="metric">
              <span>Expiry</span>
              <strong>
                {manifest.expiry ? badge(!manifest.expiry.expired, "ACTIVE", "EXPIRED") : <span className="badge neutral">N/A</span>}
              </strong>
              <small>{manifest.expiry ? formatRemaining(manifest.expiry.secondsRemaining) : "ไม่พบ expiry param"}</small>
            </article>
          </section>

          <section className="panel diagnostics">
            <div className="panel-title">
              <div>
                <p className="eyebrow">DIAGNOSTICS</p>
                <h2>ผลตรวจ</h2>
              </div>
              <span className="latency">{manifest.elapsedMs} ms</span>
            </div>

            <div className="kv-grid">
              <div><span>Status</span><b>{manifest.status} {manifest.statusText}</b></div>
              <div><span>Content-Type</span><b>{manifest.contentType || "-"}</b></div>
              <div><span>CORS allow-origin</span><b>{manifest.allowOrigin || "-"}</b></div>
              <div><span>X-U18-Cache</span><b>{manifest.u18Cache || "-"}</b></div>
              <div><span>X-U18-Guard</span><b>{manifest.u18Guard || "-"}</b></div>
              <div><span>Request ID</span><b>{manifest.requestId || "-"}</b></div>
              <div><span>Playlist type</span><b>{manifest.playlistType || (manifest.hasEndList ? "VOD" : "unknown")}</b></div>
              <div><span>Segments</span><b>{manifest.extinfCount ?? 0}</b></div>
              <div><span>Variants</span><b>{manifest.variantCount ?? 0}</b></div>
              <div><span>Target duration</span><b>{manifest.targetDuration ? `${manifest.targetDuration}s` : "-"}</b></div>
              <div><span>Encrypted</span><b>{manifest.encrypted ? "YES" : "NO"}</b></div>
              <div><span>Manifest size</span><b>{manifest.bytes.toLocaleString()} bytes</b></div>
            </div>

            <div className="binding-row">
              <span className={manifest.bindingHints?.ip ? "binding on" : "binding"}>IP param {manifest.bindingHints?.ip ? "✓" : "–"}</span>
              <span className={manifest.bindingHints?.browser ? "binding on" : "binding"}>Browser param {manifest.bindingHints?.browser ? "✓" : "–"}</span>
              <span className={manifest.bindingHints?.signature ? "binding on" : "binding"}>Signature {manifest.bindingHints?.signature ? "✓" : "–"}</span>
              <span className={manifest.bindingHints?.session ? "binding on" : "binding"}>Session hints {manifest.bindingHints?.session ? "✓" : "–"}</span>
            </div>

            {manifest.expiry && (
              <div className="notice">
                Expiry: {new Date(manifest.expiry.iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} (เวลาไทย)
              </div>
            )}

            {manifest.canary && (
              <details>
                <summary>U18 Canary</summary>
                <code className="urlblock">{manifest.canary}</code>
              </details>
            )}

            <details open>
              <summary>Manifest preview</summary>
              <pre>{manifest.preview}</pre>
            </details>

            {segment && (
              <details>
                <summary>First segment test</summary>
                <div className="kv-grid compact">
                  <div><span>Status</span><b>{segment.status ?? "-"}</b></div>
                  <div><span>Type</span><b>{segment.contentType || "-"}</b></div>
                  <div><span>Bytes</span><b>{segment.bytesReceived ?? 0}</b></div>
                  <div><span>Latency</span><b>{segment.elapsedMs ?? 0} ms</b></div>
                  <div><span>Guard</span><b>{segment.u18Guard || "-"}</b></div>
                  <div><span>Cache</span><b>{segment.u18Cache || "-"}</b></div>
                </div>
                {segment.url && <code className="urlblock">{segment.url}</code>}
                {segment.error && <div className="alert badbox">{segment.error}</div>}
              </details>
            )}
          </section>

          <section className="panel player-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">OPTIONAL PREVIEW</p>
                <h2>ทดลองเล่นผ่าน local proxy</h2>
              </div>
              {result.proxyEnabled ? <span className="badge good">ENABLED</span> : <span className="badge neutral">DISABLED</span>}
            </div>

            <video ref={videoRef} controls playsInline className="video" />
            <div className="actions">
              <button className="primary" type="button" disabled={!result.proxyEnabled || !result.ok} onClick={playPreview}>
                เล่น Preview
              </button>
              <span className="player-message">{playerMessage}</span>
            </div>
            {!result.proxyEnabled && (
              <p className="hint">
                ตั้ง <code>ENABLE_STREAM_PROXY=true</code> ตอนรัน local เพื่อเปิด Preview. ไม่แนะนำให้เปิดบน public deployment เพราะจะใช้ bandwidth สูงและอาจถูกนำไปใช้เป็น proxy.
              </p>
            )}
          </section>

          <section className="panel raw-url">
            <div className="panel-title"><h2>Final manifest URL</h2></div>
            <code className="urlblock">{manifest.finalUrl}</code>
            <p className="hint">{result.serverNote}</p>
          </section>
        </>
      )}
    </main>
  );
}
