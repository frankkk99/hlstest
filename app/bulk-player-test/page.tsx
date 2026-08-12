"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

type CardStatus = "found" | "testing" | "pass" | "blocked" | "error";

type BulkCard = {
  id: string;
  url: string;
  label: string;
  status: CardStatus;
  statusCode?: number;
  mediaUrl?: string | null;
  elapsedMs?: number;
  error?: string;
};

type DiscoverResponse = {
  ok: boolean;
  error?: string;
  count?: number;
  finalUrl?: string;
  pageStatus?: number;
  items?: Array<{ url: string; label: string }>;
  storage?: { configured: boolean; savedCount: number; error?: string | null };
};

type TestResult = {
  url: string;
  ok: boolean;
  status: number;
  sourceStatus: number;
  mediaUrl: string | null;
  contentType: string | null;
  elapsedMs: number;
  error?: string;
};

type TestResponse = {
  ok: boolean;
  error?: string;
  results?: TestResult[];
  storage?: {
    configured: boolean;
    savedCount: number;
    failedCount: number;
    errors: string[];
  };
};

type BrowserSessionResponse = {
  ok: boolean;
  error?: string;
  session?: {
    sessionId: string;
    mediaUrl: string;
    proxyUrl?: string | null;
    expiresAt: number;
  };
};

const DEFAULT_PAGE_URL = "https://missav123.com";
const BATCH_SIZE = 3;

const STATUS_LABEL: Record<CardStatus, string> = {
  found: "FOUND",
  testing: "TESTING",
  pass: "PASS",
  blocked: "BLOCKED",
  error: "ERROR",
};

function shortLabel(value: string, url: string) {
  const fallback = url.split("/").filter(Boolean).pop() || url;
  const clean = (value || fallback).replace(/\s+/g, " ").trim();
  return clean.length > 76 ? `${clean.slice(0, 73)}…` : clean;
}

function isBlocked(result: TestResult) {
  return [401, 403, 406, 429, 503].includes(result.status) || /blocked|cloudflare|forbidden|challenge|captcha/i.test(result.error || "");
}

function badgeClass(status: CardStatus) {
  return `bulk-status ${status}`;
}

export default function BulkPlayerTestPage() {
  const [pageUrl, setPageUrl] = useState(DEFAULT_PAGE_URL);
  const [cards, setCards] = useState<BulkCard[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [playerMessage, setPlayerMessage] = useState("แตะการ์ด แล้วกดเริ่มเล่นด้วย Chromium session");
  const [playerLoading, setPlayerLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const selected = cards.find((card) => card.id === selectedId) || null;
  const passCount = cards.filter((card) => card.status === "pass").length;
  const blockedCount = cards.filter((card) => card.status === "blocked").length;
  const testingCount = cards.filter((card) => card.status === "testing").length;

  useEffect(() => {
    return () => stopPlayer();
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

  function updateCards(updater: (current: BulkCard[]) => BulkCard[]) {
    setCards((current) => updater(current));
  }

  async function runTests(items: BulkCard[]) {
    setTesting(true);
    setProgress({ done: 0, total: items.length });

    for (let index = 0; index < items.length; index += BATCH_SIZE) {
      const batch = items.slice(index, index + BATCH_SIZE);
      const ids = new Set(batch.map((item) => item.id));
      updateCards((current) => current.map((item) => (ids.has(item.id) ? { ...item, status: "testing" } : item)));

      try {
        const response = await fetch("/api/bulk-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: batch.map((item) => item.url) }),
        });
        const data = (await response.json()) as TestResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (data.storage) {
          setStorageMessage(data.storage.configured
            ? `hlshub: บันทึกแล้ว ${data.storage.savedCount} รายการ${data.storage.failedCount ? ` · ล้มเหลว ${data.storage.failedCount}` : ""}`
            : "hlshub: ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY บน production จึงยังไม่บันทึกฐานข้อมูล");
        }

        const results = new Map((data.results || []).map((result) => [result.url, result]));
        updateCards((current) =>
          current.map((item) => {
            const result = results.get(item.url);
            if (!result) return item;
            return {
              ...item,
              status: result.ok ? "pass" : isBlocked(result) ? "blocked" : "error",
              statusCode: result.status || result.sourceStatus,
              mediaUrl: result.mediaUrl,
              elapsedMs: result.elapsedMs,
              error: result.error,
            };
          }),
        );
      } catch (batchError) {
        const message = batchError instanceof Error ? batchError.message : "ทดสอบชุดนี้ไม่สำเร็จ";
        updateCards((current) => current.map((item) => (ids.has(item.id) ? { ...item, status: "error", error: message } : item)));
      } finally {
        setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + batch.length) }));
      }
    }

    setTesting(false);
  }

  async function discoverAndTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDiscovering(true);
    setTesting(false);
    setError("");
    setStorageMessage("");
    setCards([]);
    setProgress({ done: 0, total: 0 });
    setSelectedId("");
    stopPlayer();
    setPlayerMessage("กำลังค้นหาลิงก์เรื่องจากหน้าหลัก…");

    try {
      const response = await fetch("/api/bulk-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl, limit: 100 }),
      });
      const data = (await response.json()) as DiscoverResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);

      const items = (data.items || []).map((item, index) => ({
        id: `${index}-${item.url}`,
        url: item.url,
        label: shortLabel(item.label, item.url),
        status: "found" as const,
      }));
      setCards(items);
      setProgress({ done: 0, total: items.length });
      if (data.storage?.configured) {
        setStorageMessage(data.storage.error
          ? `hlshub: พบรายการแล้ว แต่บันทึกเบื้องต้นไม่สำเร็จ (${data.storage.error})`
          : `hlshub: บันทึกรายการที่ค้นพบเบื้องต้นแล้ว ${data.storage.savedCount} รายการ`);
      }
      setPlayerMessage(items.length ? "พบรายการแล้ว แตะการ์ดเพื่อเลือก Player" : "ไม่พบลิงก์เรื่องในหน้านี้");

      // The list is intentionally committed before this await. Users see the
      // count and cards first, while the longer network test runs afterward.
      if (items.length) await runTests(items);
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : "ค้นหาไม่สำเร็จ");
      setPlayerMessage("ค้นหาไม่สำเร็จ");
    } finally {
      setDiscovering(false);
    }
  }

  function selectCard(card: BulkCard) {
    stopPlayer();
    setSelectedId(card.id);
    setPlayerMessage(`เลือก #${cards.findIndex((item) => item.id === card.id) + 1} แล้ว กดเริ่มเล่น`);
    requestAnimationFrame(() => document.getElementById("bulk-player")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function playSelected() {
    if (!selected) return;
    setPlayerLoading(true);
    setPlayerMessage("กำลังเปิดเรื่องนี้ด้วย Chromium และจับ HLS session…");
    stopPlayer();

    try {
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: selected.url }),
      });
      const data = (await response.json()) as BrowserSessionResponse;
      if (!response.ok || !data.ok || !data.session?.sessionId || !data.session.mediaUrl) {
        throw new Error(data.error || `เปิด Player ไม่สำเร็จ (HTTP ${response.status})`);
      }

      const browserSessionUrl = `/api/browser-session?${new URLSearchParams({
          session: data.session.sessionId,
          url: data.session.mediaUrl,
        }).toString()}`;
      const directUrl = data.session.mediaUrl;
      const video = videoRef.current;
      if (!video) throw new Error("ไม่พบ video element");

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
        video.load();
        await video.play();
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
        hlsRef.current = hls;
        let fallbackStarted = false;
        hls.on(Hls.Events.ERROR, (_event, details) => {
          if (!details.fatal) return;
          if (!fallbackStarted && directUrl !== browserSessionUrl) {
            fallbackStarted = true;
            hls.stopLoad();
            hls.loadSource(browserSessionUrl);
            setPlayerMessage("Direct HLS ถูกบล็อก กำลังสลับไป Chromium session…");
            return;
          }
          setPlayerMessage(`Player error: ${details.details || "โหลด HLS ไม่สำเร็จ"}`);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => setPlayerMessage("โหลดสำเร็จแล้ว กดปุ่ม Play ในกล่องวิดีโออีกครั้ง"));
        });
        hls.loadSource(directUrl);
        hls.attachMedia(video);
      } else {
        throw new Error("เบราว์เซอร์นี้ไม่รองรับ HLS");
      }

      setPlayerMessage("กำลังเล่นผ่าน Chromium session + HLS proxy");
    } catch (playError) {
      setPlayerMessage(playError instanceof Error ? playError.message : "เล่นไม่สำเร็จ");
    } finally {
      setPlayerLoading(false);
    }
  }

  function clearAll() {
    stopPlayer();
    setCards([]);
    setProgress({ done: 0, total: 0 });
    setSelectedId("");
    setError("");
    setStorageMessage("");
    setPlayerMessage("แตะการ์ด แล้วกดเริ่มเล่นด้วย Chromium session");
  }

  return (
    <main className="shell bulk-page">
      <section className="hero">
        <div>
          <p className="eyebrow">05 / BULK PLAYER TEST</p>
          <h1>ค้นหาหลายเรื่อง แล้วเทส Player ทีละการ์ด</h1>
          <p className="subtitle">วาง URL หน้าหลัก กดครั้งเดียว ระบบจะค้นหาลิงก์เรื่อง แสดงจำนวนที่พบก่อน แล้วค่อยทดสอบ network ด้วย Chromium เป็นชุด ๆ</p>
        </div>
        <div className="status-chip">Chromium + HLS session</div>
      </section>

      <form className="panel bulk-form" onSubmit={discoverAndTest}>
        <label className="field full">
          <span>URL หน้าหลัก</span>
          <input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder={DEFAULT_PAGE_URL} type="url" required />
        </label>
        <div className="actions full">
          <button className="primary" disabled={discovering || testing} type="submit">
            {discovering ? "กำลังค้นหา…" : testing ? "กำลังเทสต่อ…" : "ค้นหา + เริ่มเทสยาว"}
          </button>
          <button className="secondary" disabled={discovering || testing} onClick={clearAll} type="button">ล้างผลลัพธ์</button>
          <span className="hint">จำกัด 100 การ์ด · ทดสอบครั้งละ {BATCH_SIZE} เรื่อง</span>
        </div>
      </form>

      {error && <div className="alert badbox">{error}</div>}
      {storageMessage && <div className="alert notice">{storageMessage}</div>}

      {cards.length > 0 && (
        <section className="bulk-summary-grid">
          <div className="metric"><span>พบทั้งหมด</span><strong>{cards.length}</strong><small>แสดงการ์ดแล้วก่อนเริ่มเทส</small></div>
          <div className="metric"><span>PASS</span><strong>{passCount}</strong><small>จับ manifest สำเร็จ</small></div>
          <div className="metric"><span>BLOCKED</span><strong>{blockedCount}</strong><small>ต้นทาง/Cloudflare ไม่ให้ผ่าน</small></div>
          <div className="metric"><span>ความคืบหน้า</span><strong>{progress.done}/{progress.total}</strong><small>{testingCount ? `กำลังทดสอบ ${testingCount} เรื่อง` : testing ? "กำลังเตรียมชุดถัดไป" : "จบรอบทดสอบ"}</small></div>
        </section>
      )}

      {selected && (
        <section className="panel bulk-player-panel" id="bulk-player">
          <div className="panel-title">
            <div>
              <p className="eyebrow">PLAYER TEST</p>
              <h2>#{cards.findIndex((item) => item.id === selected.id) + 1} {selected.label}</h2>
            </div>
            <span className={badgeClass(selected.status)}>{STATUS_LABEL[selected.status]}</span>
          </div>
          <video ref={videoRef} className="video bulk-player-video" controls playsInline preload="metadata" />
          <div className="actions player-actions">
            <button className="primary" disabled={playerLoading} onClick={playSelected} type="button">{playerLoading ? "กำลังเปิด…" : "เริ่มเล่น"}</button>
            <button className="secondary" disabled={playerLoading} onClick={stopPlayer} type="button">หยุด Player</button>
            <span className="player-message">{playerMessage}</span>
          </div>
          <p className="hint">การกดเล่นจะเปิดหน้าเรื่องอีกครั้งด้วย Chromium session แล้วส่ง HLS ผ่าน proxy ของแอป จึงเหมาะกับต้นทางที่บล็อก fetch ปกติ</p>
        </section>
      )}

      {cards.length > 0 && (
        <section className="panel bulk-list-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">DISCOVERED TITLES</p>
              <h2>รายการที่ค้นพบ</h2>
            </div>
            <span className="latency">{testing ? "กำลังรันทดสอบแบบต่อเนื่อง" : "เลือกการ์ดเพื่อเปิด Player"}</span>
          </div>
          <div className="bulk-progress-track" aria-label="ความคืบหน้าการทดสอบ"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <div className="bulk-card-grid">
            {cards.map((card, index) => (
              <button className={`bulk-card ${selectedId === card.id ? "selected" : ""}`} key={card.id} onClick={() => selectCard(card)} type="button">
                <div className="bulk-card-top"><span className="bulk-number">#{index + 1}</span><span className={badgeClass(card.status)}>{STATUS_LABEL[card.status]}</span></div>
                <strong>{card.label}</strong>
                <small>{card.statusCode ? `HTTP ${card.statusCode}` : card.status === "testing" ? "กำลังตรวจ network…" : card.error || "รอผลทดสอบ"}{card.elapsedMs ? ` · ${(card.elapsedMs / 1000).toFixed(1)}s` : ""}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {!cards.length && !discovering && <section className="panel bulk-empty"><h2>เริ่มจาก URL หน้าหลัก</h2><p>ระบบจะนับจำนวนลิงก์ก่อน แล้วค่อยเปลี่ยน badge ของแต่ละการ์ดเป็น TESTING, PASS, BLOCKED หรือ ERROR</p></section>}
    </main>
  );
}
