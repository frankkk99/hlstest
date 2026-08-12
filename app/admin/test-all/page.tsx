"use client";

import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminCatalogFilter, CatalogItem } from "@/lib/hlshub-catalog";
import AdminShell from "../admin-shell";
import styles from "../admin.module.css";

type TestStatus = "queued" | "testing" | "pass" | "blocked" | "error" | "infra-error" | "skip";
type TestCard = CatalogItem & { testStatus: TestStatus; checkedAt?: string; detail?: string };
type CatalogResponse = { ok?: boolean; error?: string; items?: CatalogItem[]; total?: number };
type BrowserSessionResponse = {
  ok?: boolean;
  error?: string;
  pageStatus?: number;
  failureType?: "chromium" | "player";
  attempts?: number;
  session?: {
    sessionId: string;
    mediaUrl: string;
    proxyUrl?: string | null;
    diagnostics?: {
      manifest: { status: number; bytes: number };
      segment: { status: number; bytes: number };
    };
  };
};
type BulkAction = "show-only-passed" | "repair-failed";
type BulkActionResponse = { ok?: boolean; error?: string; updated?: { shown: number; movedToRepair: number } };
type CatalogScope = "all" | "public-curated";

const PAGE_SIZE = 48;
const WORKERS = 1;
const filterOptions: Array<[AdminCatalogFilter, string]> = [
  ["all", "ทุกสถานะ"],
  ["broken", "เฉพาะที่มีปัญหา"],
  ["ready", "เฉพาะที่เล่นได้ตามฐานข้อมูล"],
  ["no-player", "เฉพาะที่ไม่มี Player"],
  ["unknown", "เฉพาะที่ยังไม่ทราบสถานะ"],
];
const activeOptions = [["all", "ทั้งที่แสดงและซ่อน"], ["active", "เฉพาะที่แสดงหน้าเว็บ"], ["hidden", "เฉพาะโซนซ่อน/รอแก้ไข"]] as const;
const scopeOptions: Array<[CatalogScope, string]> = [["public-curated", "เฉพาะ 14 เรื่องหน้าเว็บ"], ["all", "คลังทั้งหมด"]];
const statusLabels: Record<TestStatus, string> = {
  queued: "รอทดสอบ",
  testing: "กำลังตรวจ",
  pass: "PASS",
  blocked: "BLOCKED",
  error: "ERROR",
  "infra-error": "CHROMIUM",
  skip: "ไม่มี Player",
};

function titleOf(item: CatalogItem) {
  return item.title || item.originalTitle || item.code || `รายการ #${item.id}`;
}

function resultStatus(error: string) {
  return /blocked|cloudflare|captcha|forbidden|allowlist|401|403|406|429|503/i.test(error) ? "blocked" as const : "error" as const;
}

function statusClass(status: TestStatus) {
  if (status === "pass") return styles.good;
  if (status === "blocked" || status === "error") return styles.bad;
  if (status === "infra-error") return styles.warn;
  if (status === "skip") return styles.warn;
  return styles.blue;
}

function isRetryablePlaybackError(message: string) {
  return /resource|network|timeout|detached|hls|manifest|segment|buffer|โหลดเกิน|เริ่มเล่นจริง/i.test(message);
}

export default function TestAllPage() {
  const [items, setItems] = useState<TestCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loadedAt, setLoadedAt] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<AdminCatalogFilter>("all");
  const [activeMode, setActiveMode] = useState<"active" | "hidden" | "all">("all");
  const [scope, setScope] = useState<CatalogScope>("public-curated");
  const [search, setSearch] = useState("");
  const [loadedScope, setLoadedScope] = useState("ทุกสถานะ · ทั้งที่แสดงและซ่อน");
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerMessage, setPlayerMessage] = useState("กดการ์ดเพื่อเรียก Player และทดสอบการเล่น");
  const cancelRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const counts = useMemo(() => ({
    all: items.length,
    testable: items.filter((item) => Boolean(item.playerPageUrl)).length,
    pass: items.filter((item) => item.testStatus === "pass").length,
    blocked: items.filter((item) => item.testStatus === "blocked").length,
    error: items.filter((item) => item.testStatus === "error").length,
    infraError: items.filter((item) => item.testStatus === "infra-error").length,
    skip: items.filter((item) => item.testStatus === "skip").length,
    tested: items.filter((item) => ["pass", "blocked", "error", "infra-error", "skip"].includes(item.testStatus)).length,
    testedPlayable: items.filter((item) => ["pass", "blocked", "error", "infra-error"].includes(item.testStatus)).length,
  }), [items]);
  const testComplete = counts.testable === counts.testedPlayable;
  const failedCount = counts.blocked + counts.error + counts.infraError + counts.skip;
  const selectedItem = selectedId === null ? null : items.find((item) => item.id === selectedId) || null;

  function stopPlayer() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setPlayerLoading(false);
  }

  function openPlayer(session: NonNullable<BrowserSessionResponse["session"]>) {
    const video = videoRef.current;
    if (!video) return Promise.reject(new Error("ไม่พบกล่อง Player สำหรับแสดงผล"));
    const playerVideo = video;
    stopPlayer();
    setPlayerLoading(true);
    setPlayerMessage("กำลังโหลดภาพและเริ่มเล่น Player…");
    video.muted = true;
    const source = session.proxyUrl || session.mediaUrl;
    const timeout = 15000;

    function waitForActualPlayback() {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          playerVideo.removeEventListener("playing", onPlaying);
          playerVideo.removeEventListener("timeupdate", onPlaying);
          playerVideo.removeEventListener("error", onError);
          if (error) reject(error);
          else resolve();
        };
        const onPlaying = () => {
          if (playerVideo.readyState >= 2 && !playerVideo.paused) finish();
        };
        const onError = () => finish(new Error("Player เริ่มเล่นจริงไม่สำเร็จ"));
        const timer = window.setTimeout(() => finish(new Error("Player เริ่มเล่นจริงเกิน 15 วินาที")), timeout);
        playerVideo.addEventListener("playing", onPlaying);
        playerVideo.addEventListener("timeupdate", onPlaying);
        playerVideo.addEventListener("error", onError);
        onPlaying();
      });
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          window.clearTimeout(timer);
          video.onloadedmetadata = null;
          video.onerror = null;
        };
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          setPlayerLoading(false);
          if (error) {
            setPlayerMessage(error.message);
            reject(error);
          } else {
            setPlayerMessage("เล่นได้แล้ว · กำลังแสดงภาพจาก Player");
            resolve();
          }
        };
        const timer = window.setTimeout(() => finish(new Error("Player โหลดเกิน 15 วินาที")), timeout);
        video.onerror = () => finish(new Error("วิดีโอไม่สามารถแสดงผลได้"));
        video.onloadedmetadata = () => {
          void video.play()
            .then(() => waitForActualPlayback())
            .then(() => finish())
            .catch(() => finish(new Error("Player เริ่มเล่นจริงไม่สำเร็จ")));
        };
        video.src = source;
        video.load();
      });
    }

    if (!Hls.isSupported()) return Promise.reject(new Error("เบราว์เซอร์นี้ไม่รองรับ HLS"));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setPlayerLoading(false);
        if (error) {
          setPlayerMessage(error.message);
          reject(error);
        } else {
          setPlayerMessage("เล่นได้แล้ว · กำลังแสดงภาพจาก Player");
          resolve();
        }
      };
      const timer = window.setTimeout(() => finish(new Error("Player โหลดเกิน 15 วินาที")), timeout);
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play()
          .then(() => waitForActualPlayback())
          .then(() => finish())
          .catch(() => finish(new Error("Player เริ่มเล่นจริงไม่สำเร็จ")));
      });
      hls.on(Hls.Events.ERROR, (_event, details) => {
        if (details.fatal) finish(new Error(`Player แสดงผลไม่สำเร็จ: ${details.details || "HLS error"}`));
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    });
  }

  async function loadCatalog() {
    setLoading(true);
    setError("");
    cancelRef.current = true;
    stopPlayer();
    setSelectedId(null);
    try {
      const loaded: CatalogItem[] = [];
      let page = 1;
      let total = 0;
      while (page <= 100) {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), filter: catalogFilter, active: activeMode, sort: "latest", scope });
        if (search.trim()) params.set("search", search.trim());
        const response = await fetch(`/api/admin/catalog?${params}`, { cache: "no-store" });
        const data = await response.json() as CatalogResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || `อ่านรายการไม่สำเร็จ (HTTP ${response.status})`);
        const batch = data.items || [];
        loaded.push(...batch);
        total = data.total || loaded.length;
        if (!batch.length || loaded.length >= total || batch.length < PAGE_SIZE) break;
        page += 1;
      }
      const nextItems = loaded.map((item) => ({
        ...item,
        testStatus: item.playerPageUrl ? "queued" as const : "skip" as const,
        detail: item.playerPageUrl ? "พร้อมตรวจหน้า Player สด" : "ไม่มีหน้า Player สำหรับเปิดทดสอบ",
      }));
      setItems(nextItems);
      setProgress({ done: 0, total: nextItems.filter((item) => Boolean(item.playerPageUrl)).length });
      setLoadedAt(new Date().toISOString());
      const filterLabel = filterOptions.find(([value]) => value === catalogFilter)?.[1] || "ทุกสถานะ";
      const activeLabel = activeOptions.find(([value]) => value === activeMode)?.[1] || "ทั้งที่แสดงและซ่อน";
      const scopeLabel = scopeOptions.find(([value]) => value === scope)?.[1] || "คลังทั้งหมด";
      setLoadedScope(`${scopeLabel} · ${filterLabel} · ${activeLabel}${search.trim() ? ` · ค้นหา “${search.trim()}”` : ""}`);
    } catch (loadError) {
      setItems([]);
      setProgress({ done: 0, total: 0 });
      setError(loadError instanceof Error ? loadError.message : "อ่านรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
      cancelRef.current = false;
    }
  }

  useEffect(() => {
    void loadCatalog();
    return () => stopPlayer();
  }, []);

  async function testOne(item: TestCard, countInProgress = false, playResult = false) {
    if (!item.playerPageUrl) return;
    if (playResult) {
      setSelectedId(item.id);
      setPlayerLoading(true);
      setPlayerMessage("กำลังเรียก Playback Session จากหน้าเรื่อง…");
    }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, testStatus: "testing", detail: "Chromium กำลังเปิดหน้าเรื่องและจับ manifest" } : entry));
    let finalMessage = "ตรวจ Player ไม่สำเร็จ";
    let finalStatus: TestStatus = "error";
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        let failureType: "chromium" | "player" = "player";
        try {
          if (attempt > 1) {
            setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, detail: "พบความผิดพลาดชั่วคราว · กำลัง retry อัตโนมัติ" } : entry));
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          const response = await fetch("/api/browser-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageUrl: item.playerPageUrl, mediaUrl: item.mediaUrl || undefined, forceFresh: true }),
          });
          const data = await response.json() as BrowserSessionResponse;
          failureType = data.failureType || "player";
          if (!response.ok || !data.ok || !data.session?.mediaUrl) {
            const failure = new Error(data.error || `เปิด Player ไม่สำเร็จ (HTTP ${response.status})`) as Error & { failureType?: "chromium" | "player" };
            failure.failureType = failureType;
            throw failure;
          }
          if (!data.session.diagnostics) throw new Error("ระบบยังไม่ได้ยืนยัน manifest และ segment แรก");
          if (playResult) await openPlayer(data.session);
          setItems((current) => current.map((entry) => entry.id === item.id ? {
            ...entry,
            testStatus: "pass",
            checkedAt: new Date().toISOString(),
            detail: `PASS · manifest HTTP ${data.session?.diagnostics?.manifest.status} · segment แรก HTTP ${data.session?.diagnostics?.segment.status} · เริ่มเล่นจริงผ่าน`,
          } : entry));
          return;
        } catch (testError) {
          const message = testError instanceof Error ? testError.message : "ตรวจ Player ไม่สำเร็จ";
          const typedError = testError as Error & { failureType?: "chromium" | "player" };
          const transient = failureType === "chromium" || typedError.failureType === "chromium" || isRetryablePlaybackError(message);
          if (attempt < 2 && transient) continue;
          finalMessage = message;
          finalStatus = failureType === "chromium" || typedError.failureType === "chromium" ? "infra-error" : resultStatus(message);
          break;
        }
      }
      setItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        testStatus: finalStatus,
        checkedAt: new Date().toISOString(),
        detail: finalStatus === "infra-error" ? `Chromium ทดสอบล้มหลัง retry · ${finalMessage}` : `Player เสียจริงหรือไม่ผ่านการตรวจ · ${finalMessage}`,
      } : entry));
      if (playResult) {
        setPlayerLoading(false);
        setPlayerMessage(finalMessage);
      }
    } finally {
      if (countInProgress) setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + 1) }));
    }
  }

  function clickCard(item: TestCard) {
    if (running || !item.playerPageUrl || item.testStatus === "testing") return;
    setError("");
    setSelectedId(item.id);
    setPlayerMessage("กำลังเรียก Playback Session จากหน้าเรื่อง…");
    requestAnimationFrame(() => document.getElementById("test-player")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    void testOne(item, false, true);
  }

  async function testAll() {
    if (running || !items.length) return;
    cancelRef.current = false;
    setError("");
    const testable = items.filter((item) => Boolean(item.playerPageUrl));
    setProgress({ done: 0, total: testable.length });
    setItems((current) => current.map((item) => item.playerPageUrl ? { ...item, testStatus: "queued", detail: "เข้าคิวรอตรวจ" } : { ...item, testStatus: "skip", detail: "ไม่มีหน้า Player สำหรับเปิดทดสอบ" }));
    setRunning(true);
    let cursor = 0;
    async function worker() {
      while (!cancelRef.current) {
        const index = cursor++;
        if (index >= testable.length) return;
        await testOne(testable[index], true, true);
      }
    }
    await Promise.all(Array.from({ length: Math.min(WORKERS, testable.length) }, () => worker()));
    setRunning(false);
  }

  function stopTesting() {
    cancelRef.current = true;
    setRunning(false);
  }

  async function applyAction(action: BulkAction) {
    if (actionLoading || running || !items.length || !testComplete) return;
    const passedIds = items.filter((item) => item.testStatus === "pass").map((item) => item.id);
    const failedIds = items.filter((item) => ["blocked", "error", "infra-error", "skip"].includes(item.testStatus)).map((item) => item.id);
    const actionLabel = action === "show-only-passed" ? "แสดงเฉพาะรายการที่ PASS และซ่อนรายการอื่นเข้าโซนรอแก้ไข" : "ซ่อนรายการที่ไม่ผ่านเข้าโซนรอแก้ไข";
    if (!window.confirm(`${actionLabel} จำนวน ${action === "show-only-passed" ? items.length : failedIds.length} รายการหรือไม่? ข้อมูลหนังจะไม่ถูกลบ`)) return;

    setActionLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/catalog/bulk-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: items.map((item) => item.id), passedIds, failedIds }),
      });
      const data = await response.json() as BulkActionResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || `ทำรายการไม่สำเร็จ (HTTP ${response.status})`);
      const failedSet = new Set(failedIds);
      const passedSet = new Set(passedIds);
      setItems((current) => current.map((item) => {
        if (action === "show-only-passed") {
          return passedSet.has(item.id)
            ? { ...item, isActive: true, detail: "PASS · แสดงหน้าเว็บแล้ว" }
            : { ...item, isActive: false, detail: "ไม่ผ่าน · ย้ายเข้าโซนรอแก้ไขแล้ว" };
        }
        return failedSet.has(item.id) ? { ...item, isActive: false, detail: "ย้ายเข้าโซนรอแก้ไขแล้ว" } : item;
      }));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "ทำรายการหลังเทสไม่สำเร็จ");
    } finally {
      setActionLoading(false);
    }
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return <AdminShell title="ทดสอบหนังทั้งหมด" description="ตรวจ Player ทีละเรื่องด้วย mediaUrl จากฐานข้อมูล พร้อมตรวจ manifest, segment แรก และการเริ่มเล่นจริง แยกความผิดพลาดของ Chromium ออกจาก Player เสีย"><section className={styles.panel}><div className={styles.panelHeader}><div><h2>กำหนดขอบเขตการเทส</h2><p>เลือกกลุ่มก่อนโหลดรายการ โดยระบบจะเปิด Chromium ทีละ 1 เรื่องเพื่อลดผลลวงจากทรัพยากรไม่พอ</p></div><div className={styles.testControls}><button className={styles.button} type="button" disabled={loading || running} onClick={() => void loadCatalog()}>{loading ? "กำลังโหลด…" : "โหลดตามตัวกรอง"}</button>{running ? <button className={`${styles.button} ${styles.buttonDanger}`} type="button" onClick={stopTesting}>หยุดการทดสอบ</button> : <button className={styles.button} type="button" disabled={loading || !items.length} onClick={() => void testAll()}>เริ่มทดสอบรายการนี้</button>}</div></div><form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); void loadCatalog(); }}><label className={styles.field}><span>ขอบเขตคลัง</span><select className={styles.select} value={scope} onChange={(event) => setScope(event.target.value as CatalogScope)}>{scopeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.field}><span>กลุ่มสถานะ</span><select className={styles.select} value={catalogFilter} onChange={(event) => setCatalogFilter(event.target.value as AdminCatalogFilter)}>{filterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.field}><span>การแสดงผล</span><select className={styles.select} value={activeMode} onChange={(event) => setActiveMode(event.target.value as typeof activeMode)}>{activeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.field}><span>ค้นหาชื่อ / รหัส (ถ้าต้องการ)</span><input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="เช่น JURA-008" /></label></form><p className={styles.testHint}>ชุดที่โหลดอยู่: <strong>{loadedScope}</strong>{loadedAt ? ` · ${new Date(loadedAt).toLocaleString("th-TH")}` : ""}</p></section>{error && <div className={styles.error}>{error}</div>}{selectedItem && <section className={`${styles.panel} ${styles.testPlayerPanel}`} id="test-player"><div className={styles.panelHeader}><div><p className={styles.kicker}>PLAYER PREVIEW</p><h2>{titleOf(selectedItem)}</h2><p>ต้องผ่าน manifest + segment แรก + เริ่มเล่นจริง จึงจะขึ้น PASS</p></div><span className={`${styles.statusPill} ${statusClass(selectedItem.testStatus)}`}>{statusLabels[selectedItem.testStatus]}</span></div><video ref={videoRef} className={styles.testVideo} controls playsInline muted preload="metadata" /><div className={styles.testPlayerBar}><button className={styles.button} type="button" disabled={playerLoading} onClick={stopPlayer}>หยุด Player</button><span>{playerLoading ? "กำลังโหลดและเริ่มเล่น…" : playerMessage}</span></div></section>}<section className={styles.metricGrid}><article className={styles.metric}><span>รายการทั้งหมด</span><strong>{counts.all.toLocaleString()}</strong><small>รายการในขอบเขตนี้</small></article><article className={styles.metric}><span>พร้อมตรวจ</span><strong className={styles.blue}>{counts.testable.toLocaleString()}</strong><small>มีหน้า Player ต้นทาง</small></article><article className={styles.metric}><span>PASS</span><strong className={styles.good}>{counts.pass.toLocaleString()}</strong><small>manifest + segment + เล่นจริง</small></article><article className={styles.metric}><span>BLOCKED / PLAYER</span><strong className={styles.bad}>{(counts.blocked + counts.error).toLocaleString()}</strong><small>Player ไม่ผ่านการตรวจ</small></article><article className={styles.metric}><span>CHROMIUM</span><strong className={styles.warn}>{counts.infraError.toLocaleString()}</strong><small>ทดสอบล้มหลัง retry</small></article><article className={styles.metric}><span>ไม่มี Player</span><strong className={styles.warn}>{counts.skip.toLocaleString()}</strong><small>ข้ามเพราะไม่มีลิงก์ต้นทาง</small></article></section>{items.length > 0 && <><section className={styles.panel}><div className={styles.panelHeader}><div><h2>Action หลังเทส</h2><p>ทดสอบแล้ว {counts.tested}/{counts.testable} รายการ · ไม่ผ่าน {failedCount} รายการ · {testComplete ? "พร้อมจัดการผล" : "ต้องเทสให้ครบก่อนใช้ Action"}</p></div><div className={styles.testControls}><button className={styles.button} type="button" disabled={actionLoading || running || !testComplete} onClick={() => void applyAction("show-only-passed")}>{actionLoading ? "กำลังบันทึก…" : "แสดงเฉพาะที่ผ่าน"}</button><button className={`${styles.button} ${styles.buttonDanger}`} type="button" disabled={actionLoading || running || !testComplete || !failedCount} onClick={() => void applyAction("repair-failed")}>ส่งที่ไม่ผ่านเข้ารอแก้ไข</button><a className={styles.topLink} href="/admin/catalog?active=hidden&filter=all">เปิดโซนรอแก้ไข ↗</a></div></div><p className={styles.testHint}>“แสดงเฉพาะที่ผ่าน” จะเปิดรายการ PASS และซ่อนรายการอื่นทั้งหมดในชุดนี้ ส่วน “ส่งที่ไม่ผ่านเข้ารอแก้ไข” จะซ่อน BLOCKED / PLAYER / CHROMIUM / ไม่มี Player โดยไม่ลบข้อมูล</p></section><section className={styles.panel}><div className={styles.panelHeader}><div><h2>ความคืบหน้า {progress.done}/{progress.total}</h2><p>{running ? "กำลังตรวจทีละ 1 เรื่อง…" : progress.total ? (progress.done === progress.total ? "ตรวจครบแล้ว" : "พร้อมเริ่มรอบใหม่") : "ไม่มีรายการที่พร้อมตรวจ"}</p></div><span className={`${styles.statusPill} ${running ? styles.blue : percent === 100 ? styles.good : styles.warn}`}>{running ? `${percent}%` : progress.total && percent === 100 ? "เสร็จแล้ว" : "รอเริ่ม"}</span></div><div className={styles.testProgress}><span style={{ width: `${percent}%` }} /></div><div className={styles.testCardGrid}>{items.map((item) => <button className={`${styles.testCard} ${item.testStatus === "pass" ? styles.testCardPass : ""} ${item.testStatus === "blocked" || item.testStatus === "error" ? styles.testCardFail : ""}`} key={item.id} type="button" disabled={running || !item.playerPageUrl || item.testStatus === "testing"} onClick={() => clickCard(item)} aria-label={`ทดสอบ Player ${titleOf(item)}`}><div className={styles.testCardHeader}><div className={styles.testCardTitle}><strong title={titleOf(item)}>{titleOf(item)}</strong><span>{item.isSeries ? "ซีรีส์" : "หนัง"} · #{item.id}{item.isActive ? " · เปิดแสดง" : " · ซ่อน"}</span></div><span className={`${styles.statusPill} ${statusClass(item.testStatus)}`}>{statusLabels[item.testStatus]}</span></div><p className={styles.testCardUrl}>{item.playerPageUrl || "ไม่มี player_page_url"}</p><p className={styles.testCardDetail}>{item.detail || "กดการ์ดเพื่อทดสอบ Player"}{item.checkedAt ? ` · ${new Date(item.checkedAt).toLocaleTimeString("th-TH")}` : ""}</p></button>)}</div></section></>}{!loading && !items.length && !error && <div className={styles.empty}>ไม่พบรายการในคลัง</div>}</AdminShell>;
}
