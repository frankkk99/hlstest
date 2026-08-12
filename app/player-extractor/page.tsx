"use client";

import Hls from "hls.js";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type CandidateTest = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  contentType?: string;
  contentLength?: string | null;
  contentRange?: string | null;
  allowOrigin?: string | null;
  bytesRead?: number;
  elapsedMs?: number;
  isHls?: boolean;
  variantCount?: number;
  segmentCount?: number;
  targetDuration?: string | null;
  playlistType?: string | null;
  hasEndList?: boolean;
  encrypted?: boolean;
  firstMediaUrl?: string | null;
  preview?: string;
};

type Candidate = {
  url: string;
  type: "hls" | "mp4";
  role: "manifest" | "video" | "preview";
  quality: string | null;
  source: string;
  test: CandidateTest | null;
};

type ExtractResult = {
  ok: boolean;
  error?: string;
  source?: {
    mode: "fetched-page" | "pasted-html" | "chromium-session";
    requestedUrl: string | null;
    finalUrl: string | null;
    status: number | null;
    bytes: number;
    redirects: string[];
  };
  parser?: {
    packedBlocks: number;
    candidateCount: number;
    note: string;
  };
  candidates?: Candidate[];
  proxyEnabled?: boolean;
  warnings?: string[];
};

type BrowserSession = {
  sessionId: string;
  mediaUrl?: string;
  cookie: string;
  userAgent: string;
  referer: string;
  origin: string;
  expiresAt: number;
};

type BrowserSessionResult = {
  ok: boolean;
  error?: string;
  session?: BrowserSession;
};

const SAMPLE_PAGE = "https://missav123.com/th/dldss-002-uncensored-leak";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

function statusLabel(test: CandidateTest | null) {
  if (!test) return "ยังไม่ได้ทดสอบ";
  if (test.skipped) return "SKIPPED";
  if (test.ok) return "PASS";
  return "FAIL";
}

function statusClass(test: CandidateTest | null) {
  if (!test || test.skipped) return "extractor-status neutral";
  return `extractor-status ${test.ok ? "good" : "bad"}`;
}

function humanBytes(value?: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function explainTest(candidate: Candidate) {
  const test = candidate.test;
  if (!test) return "ยังไม่ได้ยิง request ทดสอบ";
  if (test.skipped) return test.error || "ข้ามการทดสอบ";
  if (!test.ok) return test.error || `HTTP ${test.status || 0} หรือรูปแบบไฟล์ไม่ตรงกับชนิดที่พบ`;
  if (candidate.type === "hls") {
    return `อ่าน #EXTM3U ได้${test.variantCount ? `, พบ ${test.variantCount} quality` : ""}${test.segmentCount ? ` และ ${test.segmentCount} segment` : ""}`;
  }
  return `เซิร์ฟเวอร์ตอบ MP4 ได้${test.contentRange ? ` (${test.contentRange})` : ""}`;
}

export default function PlayerExtractorPage() {
  const [pageUrl, setPageUrl] = useState(SAMPLE_PAGE);
  const [html, setHtml] = useState("");
  const [origin, setOrigin] = useState("https://missav123.com");
  const [referer, setReferer] = useState(SAMPLE_PAGE);
  const [userAgent, setUserAgent] = useState(DEFAULT_UA);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [playMode, setPlayMode] = useState<"direct" | "proxy">("direct");
  const [browserSession, setBrowserSession] = useState<BrowserSession | null>(null);
  const [browserSessionLoading, setBrowserSessionLoading] = useState(false);
  const [playerMessage, setPlayerMessage] = useState("เลือก URL แล้วกดเริ่มเล่น");
  const [copiedUrl, setCopiedUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const candidates = result?.candidates || [];
  const selected = candidates.find((candidate) => candidate.url === selectedUrl) || null;
  const playUrl = useMemo(() => {
    if (!selected) return "";
    if (playMode !== "proxy" || !result?.proxyEnabled) return selected.url;
    if (browserSession?.sessionId && selected.type === "hls") {
      const params = new URLSearchParams({ session: browserSession.sessionId, url: selected.url });
      return `/api/browser-session?${params.toString()}`;
    }
    const params = new URLSearchParams({ url: selected.url });
    if (origin) params.set("origin", origin);
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    if (browserSession?.cookie) params.set("cookie", browserSession.cookie);
    return `/api/stream?${params.toString()}`;
  }, [browserSession, origin, playMode, referer, result?.proxyEnabled, selected, userAgent]);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, []);

  function stopPlayer() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  async function extract(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setResult(null);
    setSelectedUrl("");
    setBrowserSession(null);
    stopPlayer();
    setPlayerMessage("กำลังอ่านหน้าและค้นหา source player…");

    try {
      const response = await fetch("/api/extract-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl,
          html,
          origin,
          referer,
          userAgent,
          testMedia: true,
        }),
      });
      let data = (await response.json()) as ExtractResult;

      // A source page may reject a plain server fetch with Cloudflare 403 even
      // though it plays normally in a real browser. Resolve it through the
      // Chromium session route before showing an empty result to the user.
      const hasPassingCandidate = data.candidates?.some((candidate) => candidate.test?.ok) || false;
      if (pageUrl && (!data.candidates?.length || !hasPassingCandidate)) {
        const session = await resolveBrowserSession();
        if (session?.mediaUrl) {
          const browserCandidate: Candidate = {
            url: session.mediaUrl,
            type: "hls",
            role: "manifest",
            quality: null,
            source: "Chromium network session",
            test: {
              ok: true,
              status: 200,
              statusText: "OK",
              contentType: "application/vnd.apple.mpegurl",
              isHls: true,
              elapsedMs: 0,
            },
          };
          data = {
            ...data,
            ok: true,
            error: undefined,
            source: {
              mode: "chromium-session",
              requestedUrl: pageUrl,
              finalUrl: session.referer,
              status: 200,
              bytes: 0,
              redirects: [],
            },
            parser: {
              packedBlocks: 0,
              candidateCount: 1,
              note: "หน้าเว็บถูกเปิดด้วย Chromium และจับ HLS manifest จาก network session โดยตรง",
            },
            candidates: [browserCandidate],
            proxyEnabled: true,
            warnings: ["ต้นทางตอบ 403 เมื่อ fetch แบบธรรมดา จึงใช้ Chromium session เพื่อรับ Cloudflare context และส่ง HLS ผ่าน proxy"],
          };
        }
      }

      setResult(data);
      setPlayMode(data.proxyEnabled ? "proxy" : "direct");
      const first = data.candidates?.find((candidate) => candidate.role === "manifest") || data.candidates?.[0];
      if (first) {
        setSelectedUrl(first.url);
        setPlayerMessage("พบ source แล้ว กดเริ่มเล่นด้านล่าง");
      } else {
        setPlayerMessage("ไม่พบ URL ที่ลงท้ายด้วย .m3u8 หรือ .mp4");
      }
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Extraction failed" });
      setPlayerMessage("การดึงข้อมูลล้มเหลว");
    } finally {
      setLoading(false);
    }
  }

  function selectCandidate(url: string) {
    stopPlayer();
    setSelectedUrl(url);
    setBrowserSession(null);
    setPlayerMessage("เลือก URL แล้ว กดเริ่มเล่น");
  }

  async function resolveBrowserSession() {
    if (browserSession && browserSession.expiresAt > Date.now() + 15_000) return browserSession;
    if (!pageUrl) return null;

    setBrowserSessionLoading(true);
    setPlayerMessage("กำลังเปิดหน้าเว็บต้นทางด้วย Chromium เพื่อรับ session ของ CDN…");
    try {
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl, origin, referer, userAgent }),
      });
      const data = (await response.json()) as BrowserSessionResult;
      if (!response.ok || !data.ok || !data.session) {
        setPlayerMessage(data.error || "Chromium ไม่สามารถรับ session จากหน้าเว็บต้นทางได้");
        return null;
      }
      setBrowserSession(data.session);
      return data.session;
    } catch (error) {
      setPlayerMessage(error instanceof Error ? error.message : "Browser session failed");
      return null;
    } finally {
      setBrowserSessionLoading(false);
    }
  }

  async function playSelected() {
    const video = videoRef.current;
    if (!video || !selected || !playUrl) return;

    let session = browserSession;
    if (selected.type === "hls" && playMode === "proxy" && pageUrl) {
      session = await resolveBrowserSession();
      if (!session) return;
    }

    const activePlayUrl =
      playMode === "proxy" && selected && session?.sessionId && selected.type === "hls"
        ? (() => {
            const params = new URLSearchParams({ session: session.sessionId, url: selected.url });
            return `/api/browser-session?${params.toString()}`;
          })()
        : playMode === "proxy" && selected && session?.cookie
          ? (() => {
            const params = new URLSearchParams({ url: selected.url });
            if (session.origin) params.set("origin", session.origin);
            if (session.referer) params.set("referer", session.referer);
            if (session.userAgent) params.set("ua", session.userAgent);
            params.set("cookie", session.cookie);
            return `/api/stream?${params.toString()}`;
            })()
          : playUrl;

    stopPlayer();
    setPlayerMessage(`${browserSessionLoading ? "กำลังเตรียม session · " : ""}กำลังโหลด ${selected.type.toUpperCase()}…`);

    if (selected.type === "mp4") {
      video.src = activePlayUrl;
      video.load();
      void video.play().then(() => setPlayerMessage("กำลังเล่น MP4")).catch(() => {
        setPlayerMessage("โหลด MP4 แล้ว แต่ browser ยังไม่อนุญาต autoplay ให้กดปุ่มเล่นบน video");
      });
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = activePlayUrl;
      video.load();
      void video.play().then(() => setPlayerMessage("กำลังเล่น HLS ด้วย native player")).catch(() => {
        setPlayerMessage("โหลด HLS แล้ว ให้กดปุ่มเล่นบน video");
      });
      return;
    }

    if (!Hls.isSupported()) {
      setPlayerMessage("Browser นี้ไม่รองรับ HLS.js และไม่มี native HLS");
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
    });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(activePlayUrl));
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      setPlayerMessage(`Manifest ผ่านแล้ว พบ ${data.levels.length} quality กำลังเล่น`);
      void video.play().catch(() => setPlayerMessage("Manifest ผ่านแล้ว ให้กดปุ่มเล่นบน video"));
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setPlayerMessage(`HLS error: ${data.details}${playMode === "direct" ? " — ลองใช้ Proxy ผ่าน server" : " — ต้นทางยังบล็อก request"}`);
        hls.destroy();
        hlsRef.current = null;
      }
    });
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl(""), 1600);
  }

  return (
    <main className="shell extractor-page">
      <section className="hero">
        <div>
          <p className="eyebrow">PLAYER SOURCE EXTRACTOR</p>
          <h1>ดึง HLS / MP4 จากหน้าเว็บ แล้วทดสอบเล่น</h1>
          <p className="subtitle">
            ใส่ URL หน้าเว็บหรือวาง HTML ที่คัดลอกมา ระบบจะค้นหา .m3u8/.mp4, ถอด JavaScript ที่ถูก pack, ตรวจ HTTP และเปิด Player ให้เลือกทดสอบทีละ source
          </p>
        </div>
        <div className="status-chip">Extract · Test · Play</div>
      </section>

      <form className="panel extractor-form" onSubmit={extract}>
        <div className="extractor-section-title">
          <div>
            <p className="eyebrow">01 / SOURCE</p>
            <h2>แหล่งข้อมูลที่จะให้ระบบอ่าน</h2>
          </div>
          <span className="extractor-mini-note">เลือกอย่างใดอย่างหนึ่ง หรือใส่ทั้งคู่ก็ได้</span>
        </div>

        <label className="field full">
          <span>URL หน้าเว็บต้นทาง</span>
          <input
            value={pageUrl}
            onChange={(event) => {
              const next = event.target.value;
              setPageUrl(next);
              if (next) {
                try {
                  setOrigin(new URL(next).origin);
                  setReferer(next);
                } catch {
                  // Wait for a complete URL.
                }
              }
            }}
            placeholder="https://example.com/video-page"
            spellCheck={false}
          />
          <small className="field-hint">กดดึงจาก URL เพื่อให้ server ของ hlstest fetch HTML ให้ ถ้าเว็บป้องกันการดึง ให้ใช้ช่องวาง HTML ด้านล่างแทน</small>
        </label>

        <label className="field full">
          <span>HTML ที่คัดลอกจาก View Source / DevTools (ถ้ามี)</span>
          <textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            placeholder="วาง HTML ทั้งหน้า หรือเฉพาะส่วน script ที่มี player…"
            rows={7}
            spellCheck={false}
          />
          <small className="field-hint">ถ้ามี HTML ระบบจะใช้ HTML นี้เป็นหลัก และไม่ต้อง fetch URL ซ้ำ</small>
        </label>

        <div className="extractor-section-title extractor-section-title-small full">
          <div>
            <p className="eyebrow">02 / REQUEST CONTEXT</p>
            <h2>Header สำหรับตรวจ source และเล่นผ่าน proxy</h2>
          </div>
        </div>

        <label className="field">
          <span>Origin</span>
          <input value={origin} onChange={(event) => setOrigin(event.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          <span>Referer</span>
          <input value={referer} onChange={(event) => setReferer(event.target.value)} spellCheck={false} />
        </label>
        <label className="field full">
          <span>User-Agent</span>
          <input value={userAgent} onChange={(event) => setUserAgent(event.target.value)} spellCheck={false} />
        </label>

        <div className="actions full">
          <button className="primary" type="submit" disabled={loading || (!pageUrl && !html.trim())}>
            {loading ? "กำลังดึงและทดสอบ…" : "ดึง source + ทดสอบทั้งหมด"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setPageUrl("");
              setHtml("");
              setResult(null);
              setSelectedUrl("");
              setBrowserSession(null);
              stopPlayer();
              setPlayerMessage("พร้อมเริ่มใหม่");
            }}
          >
            ล้างค่า
          </button>
          <button className="secondary" type="button" onClick={() => { setPageUrl(SAMPLE_PAGE); setHtml(""); }}>
            ใส่ตัวอย่างนี้
          </button>
        </div>
      </form>

      {result?.error && <div className="alert badbox">{result.error}</div>}

      {result?.source && (
        <section className="extractor-source-summary">
          <div>
            <span className="extractor-label">แหล่งที่อ่าน</span>
            <strong>
              {result.source.mode === "fetched-page"
                ? "Fetched page"
                : result.source.mode === "chromium-session"
                  ? "Chromium session"
                  : "Pasted HTML"}
            </strong>
          </div>
          <div>
            <span className="extractor-label">HTTP</span>
            <strong>{result.source.status ?? "ไม่ยิงหน้าเว็บ"}</strong>
          </div>
          <div>
            <span className="extractor-label">ขนาด HTML</span>
            <strong>{humanBytes(result.source.bytes)}</strong>
          </div>
          <div>
            <span className="extractor-label">Packed blocks</span>
            <strong>{result.parser?.packedBlocks ?? 0}</strong>
          </div>
          <div>
            <span className="extractor-label">พบ source</span>
            <strong>{result.parser?.candidateCount ?? 0}</strong>
          </div>
        </section>
      )}

      {candidates.length > 0 && (
        <section className="panel extractor-results">
          <div className="panel-title">
            <div>
              <p className="eyebrow">03 / FOUND SOURCES</p>
              <h2>รายการที่ค้นพบและผลตรวจ</h2>
            </div>
            <span className="extractor-mini-note">ทดสอบอัตโนมัติสูงสุด 20 URL</span>
          </div>

          <div className="extractor-callout">
            <b>อ่านผลอย่างไร:</b> PASS หมายถึง server อ่านชนิดไฟล์ได้, FAIL หมายถึง HTTP/รูปแบบไฟล์ไม่ผ่าน, SKIPPED หมายถึง host ไม่อยู่ใน allowlist จึงไม่ยิง request
          </div>

          <div className="candidate-list">
            {candidates.map((candidate, index) => (
              <article className={`candidate-card ${selectedUrl === candidate.url ? "selected" : ""}`} key={candidate.url}>
                <div className="candidate-head">
                  <div className="candidate-title-row">
                    <span className={`type-pill ${candidate.type}`}>{candidate.type === "hls" ? "HLS" : "MP4"}</span>
                    <b>{candidate.role === "manifest" ? "Manifest หลัก" : candidate.role === "preview" ? "Preview" : "ไฟล์วิดีโอ"}</b>
                    {candidate.quality && <span className="quality-pill">{candidate.quality}</span>}
                    <span className={statusClass(candidate.test)}>{statusLabel(candidate.test)}</span>
                  </div>
                  <span className="candidate-index">#{index + 1}</span>
                </div>

                <code className="candidate-url">{candidate.url}</code>
                <div className="candidate-meta">
                  <span>พบจาก: {candidate.source}</span>
                  {candidate.test?.status !== undefined && <span>HTTP {candidate.test.status} · {candidate.test.elapsedMs ?? 0} ms</span>}
                  {candidate.test?.contentType && <span>{candidate.test.contentType}</span>}
                  {candidate.test?.bytesRead !== undefined && <span>อ่าน {humanBytes(candidate.test.bytesRead)}</span>}
                </div>
                <p className="candidate-explain">{explainTest(candidate)}</p>

                {candidate.type === "hls" && candidate.test?.ok && (
                  <div className="candidate-detail-grid">
                    <span>Variants <b>{candidate.test.variantCount ?? 0}</b></span>
                    <span>Segments <b>{candidate.test.segmentCount ?? 0}</b></span>
                    <span>Target <b>{candidate.test.targetDuration ? `${candidate.test.targetDuration}s` : "-"}</b></span>
                    <span>Encrypted <b>{candidate.test.encrypted ? "YES" : "NO"}</b></span>
                  </div>
                )}

                <div className="candidate-actions">
                  <button className="primary" type="button" onClick={() => selectCandidate(candidate.url)}>
                    {selectedUrl === candidate.url ? "เลือกอยู่" : "เลือกเล่น"}
                  </button>
                  <button className="secondary" type="button" onClick={() => copyUrl(candidate.url)}>
                    {copiedUrl === candidate.url ? "คัดลอกแล้ว ✓" : "คัดลอก URL"}
                  </button>
                </div>

                {candidate.test?.preview && (
                  <details>
                    <summary>ดู Manifest preview</summary>
                    <pre>{candidate.test.preview}</pre>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {result?.parser && candidates.length === 0 && (
        <section className="panel extractor-empty">
          <h2>ยังไม่พบ .m3u8 หรือ .mp4</h2>
          <p>ลองใช้ View Source แทน Elements แล้ววาง HTML ทั้งหน้า หรือค้นคำว่า <code>m3u8</code>, <code>mp4</code>, <code>source1280</code>, <code>source842</code> ในหน้าเว็บต้นทาง</p>
        </section>
      )}

      <section className="panel extractor-player">
        <div className="panel-title">
          <div>
            <p className="eyebrow">04 / PLAYER</p>
            <h2>ทดสอบเล่น source ที่เลือก</h2>
          </div>
          {selected && <span className={`type-pill ${selected.type}`}>{selected.type.toUpperCase()}</span>}
        </div>

        <div className="player-toolbar">
          <label className="mode-option">
            <input type="radio" checked={playMode === "direct"} onChange={() => setPlayMode("direct")} />
            <span>Direct URL</span>
          </label>
          <label className={`mode-option ${!result?.proxyEnabled ? "disabled" : ""}`}>
            <input type="radio" checked={playMode === "proxy"} onChange={() => setPlayMode("proxy")} disabled={!result?.proxyEnabled} />
            <span>Proxy ผ่าน server (แนะนำ)</span>
          </label>
          <span className="player-context">{playMode === "proxy" ? (browserSession ? "Chromium session + Referer/Origin พร้อมใช้" : result?.proxyEnabled ? "กำลังเตรียม Chromium session เมื่อเริ่มเล่น" : "proxy ปิดอยู่") : "ยิงจาก browser โดยตรง"}</span>
        </div>

        <video ref={videoRef} controls playsInline className="video extractor-video" />
        <div className="actions player-actions">
          <button className="primary" type="button" disabled={!selected} onClick={playSelected}>เริ่มเล่น source ที่เลือก</button>
          <button className="secondary" type="button" disabled={!selected} onClick={stopPlayer}>หยุด / reset</button>
          <span className="player-message">{playerMessage}</span>
        </div>
        {selected && <code className="urlblock">{playUrl}</code>}
        {!result?.proxyEnabled && (
          <p className="hint extractor-warning">Proxy ถูกปิดอยู่: ตั้ง <code>ENABLE_STREAM_PROXY=true</code> และเพิ่ม host ใน <code>ALLOWED_HLS_HOSTS</code> ก่อนใช้โหมดนี้</p>
        )}
      </section>

      <section className="panel extractor-explanation">
        <div className="panel-title">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2>คำอธิบายการทำงานและการอ่านปัญหา</h2>
          </div>
        </div>
        <div className="explanation-grid">
          <article>
            <span className="step-number">01</span>
            <h3>อ่าน source</h3>
            <p>ระบบอ่าน HTML แบบข้อความ ไม่ execute script ของเว็บต้นทาง จึงค้น URL ที่เขียนตรง ๆ และ URL ที่ถูก escape เช่น <code>https:\\/\\/host\\/file.m3u8</code> ได้</p>
          </article>
          <article>
            <span className="step-number">02</span>
            <h3>ถอด JavaScript packer</h3>
            <p>ถ้าหน้าใช้ Dean Edwards Packer ระบบจะแทน token ตาม dictionary กลับเป็นชื่อจริง เช่น <code>source</code>, <code>source842</code>, <code>source1280</code> แล้วค้นหา media URL ที่ได้</p>
          </article>
          <article>
            <span className="step-number">03</span>
            <h3>ตรวจชนิดไฟล์</h3>
            <p>HLS ต้องตอบเนื้อหาที่ขึ้นต้นด้วย <code>#EXTM3U</code> ส่วน MP4 ตรวจจาก HTTP status, Content-Type และ byte แรกแบบ Range request</p>
          </article>
          <article>
            <span className="step-number">04</span>
            <h3>เล่นจริง</h3>
            <p>Chrome/Edge ใช้ HLS.js, Safari/iOS ใช้ native HLS ส่วน MP4 ใช้ video element โดยตรง หาก CDN บล็อก browser ระบบจะเปิด Chromium รับ session แล้ว relay manifest และ segment ผ่าน proxy เดียวกัน</p>
          </article>
        </div>

        <div className="diagnostic-table-wrap">
          <h3>อาการที่พบและความหมาย</h3>
          <table className="diagnostic-table">
            <tbody>
              <tr><th>PASS แต่เล่นไม่ได้</th><td>มักเป็น CORS, signed URL ผูก IP/session, Referer ไม่ตรง หรือ URL หมดอายุ</td></tr>
              <tr><th>HTTP 403 / 401</th><td>ต้นทางปฏิเสธ header, token, cookie หรือ hotlink protection ต้องใช้ context เดิมที่ได้รับอนุญาต</td></tr>
              <tr><th>HTTP 200 แต่ HLS FAIL</th><td>ได้หน้า HTML/Cloudflare/error page แทน manifest ให้ดู Content-Type และ Manifest preview</td></tr>
              <tr><th>SKIPPED</th><td>host ของ media ไม่อยู่ใน allowlist ของ server จึงไม่ยิงทดสอบและ proxy จะไม่รับ URL นี้</td></tr>
              <tr><th>Manifest PASS แต่ segment เล่นไม่ได้</th><td>master playlist เปิดได้ แต่ child playlist/segment อาจมีสิทธิ์หรือ query signature คนละชุด</td></tr>
            </tbody>
          </table>
        </div>

        {result?.warnings?.map((warning) => <p className="hint extractor-warning" key={warning}>• {warning}</p>)}
      </section>
    </main>
  );
}
