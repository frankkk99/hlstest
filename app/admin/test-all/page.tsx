"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogItem } from "@/lib/hlshub-catalog";
import AdminShell from "../admin-shell";
import styles from "../admin.module.css";

type TestStatus = "queued" | "testing" | "pass" | "blocked" | "error" | "skip";
type TestCard = CatalogItem & { testStatus: TestStatus; checkedAt?: string; detail?: string };
type CatalogResponse = { ok?: boolean; error?: string; items?: CatalogItem[]; total?: number };
type BrowserSessionResponse = {
  ok?: boolean;
  error?: string;
  pageStatus?: number;
  session?: { sessionId: string; mediaUrl: string };
};

const PAGE_SIZE = 48;
const WORKERS = 3;
const statusLabels: Record<TestStatus, string> = {
  queued: "รอทดสอบ",
  testing: "กำลังตรวจ",
  pass: "PASS",
  blocked: "BLOCKED",
  error: "ERROR",
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
  if (status === "skip") return styles.warn;
  return styles.blue;
}

export default function TestAllPage() {
  const [items, setItems] = useState<TestCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loadedAt, setLoadedAt] = useState("");
  const cancelRef = useRef(false);

  const counts = useMemo(() => ({
    all: items.length,
    testable: items.filter((item) => Boolean(item.playerPageUrl)).length,
    pass: items.filter((item) => item.testStatus === "pass").length,
    blocked: items.filter((item) => item.testStatus === "blocked").length,
    error: items.filter((item) => item.testStatus === "error").length,
    skip: items.filter((item) => item.testStatus === "skip").length,
  }), [items]);

  async function loadCatalog() {
    setLoading(true);
    setError("");
    cancelRef.current = true;
    try {
      const loaded: CatalogItem[] = [];
      let page = 1;
      let total = 0;
      while (page <= 100) {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), filter: "all", active: "all", sort: "latest" });
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
    } catch (loadError) {
      setItems([]);
      setProgress({ done: 0, total: 0 });
      setError(loadError instanceof Error ? loadError.message : "อ่านรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
      cancelRef.current = false;
    }
  }

  useEffect(() => { void loadCatalog(); }, []);

  async function testOne(item: TestCard) {
    if (!item.playerPageUrl) return;
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, testStatus: "testing", detail: "Chromium กำลังเปิดหน้าเรื่องและจับ manifest" } : entry));
    try {
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: item.playerPageUrl, forceFresh: true }),
      });
      const data = await response.json() as BrowserSessionResponse;
      if (!response.ok || !data.ok || !data.session?.mediaUrl) throw new Error(data.error || `เปิด Player ไม่สำเร็จ (HTTP ${response.status})`);
      setItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        testStatus: "pass",
        checkedAt: new Date().toISOString(),
        detail: `พบ HLS manifest · หน้าเว็บ HTTP ${data.pageStatus || "?"}`,
      } : entry));
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : "ตรวจ Player ไม่สำเร็จ";
      setItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        testStatus: resultStatus(message),
        checkedAt: new Date().toISOString(),
        detail: message,
      } : entry));
    } finally {
      setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + 1) }));
    }
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
        await testOne(testable[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(WORKERS, testable.length) }, () => worker()));
    setRunning(false);
  }

  function stopTesting() {
    cancelRef.current = true;
    setRunning(false);
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return <AdminShell title="ทดสอบหนังทั้งหมด" description="โหลดรายการจากคลัง HLSHUB ทั้งที่เปิดและซ่อนไว้ แล้วตรวจหน้า Player ต้นทางจริงทุกเรื่องด้วย Chromium แบบขนาน ใช้สำหรับเช็กทั้งระบบในรอบเดียว"><section className={styles.panel}><div className={styles.panelHeader}><div><h2>รอบตรวจล่าสุด</h2><p>ผลรอบนี้เป็นการตรวจสดและไม่แก้ข้อมูลรายการเดิมอัตโนมัติ</p></div><div className={styles.testControls}><button className={styles.button} type="button" disabled={loading || running} onClick={() => void loadCatalog()}>{loading ? "กำลังโหลด…" : "โหลดรายการใหม่"}</button>{running ? <button className={`${styles.button} ${styles.buttonDanger}`} type="button" onClick={stopTesting}>หยุดการทดสอบ</button> : <button className={styles.button} type="button" disabled={loading || !items.length} onClick={() => void testAll()}>เริ่มทดสอบทุกเรื่อง</button>}</div></div><p className={styles.testHint}>ระบบจะข้ามเฉพาะเรื่องที่ไม่มีหน้า Player ในฐานข้อมูล และจะเปิดเรื่องที่เหลือใหม่ทีละ {WORKERS} เรื่องเพื่อหลีกเลี่ยงการยิงหนักเกินไป{loadedAt ? ` · โหลดเมื่อ ${new Date(loadedAt).toLocaleString("th-TH")}` : ""}</p></section>{error && <div className={styles.error}>{error}</div>}<section className={styles.metricGrid}><article className={styles.metric}><span>รายการทั้งหมด</span><strong>{counts.all.toLocaleString()}</strong><small>รายการที่อยู่ในคลัง</small></article><article className={styles.metric}><span>พร้อมตรวจ</span><strong className={styles.blue}>{counts.testable.toLocaleString()}</strong><small>มีหน้า Player ต้นทาง</small></article><article className={styles.metric}><span>PASS</span><strong className={styles.good}>{counts.pass.toLocaleString()}</strong><small>จับ manifest สดสำเร็จ</small></article><article className={styles.metric}><span>BLOCKED</span><strong className={styles.bad}>{counts.blocked.toLocaleString()}</strong><small>ต้นทางบล็อกหรือไม่อนุญาต</small></article><article className={styles.metric}><span>ERROR</span><strong className={styles.bad}>{counts.error.toLocaleString()}</strong><small>เปิดหรือจับ Player ไม่สำเร็จ</small></article><article className={styles.metric}><span>ไม่มี Player</span><strong className={styles.warn}>{counts.skip.toLocaleString()}</strong><small>ข้ามเพราะไม่มีลิงก์ต้นทาง</small></article></section>{items.length > 0 && <section className={styles.panel}><div className={styles.panelHeader}><div><h2>ความคืบหน้า {progress.done}/{progress.total}</h2><p>{running ? "กำลังตรวจหน้า Player สด…" : progress.total ? (progress.done === progress.total ? "ตรวจครบแล้ว" : "พร้อมเริ่มรอบใหม่") : "ไม่มีรายการที่พร้อมตรวจ"}</p></div><span className={`${styles.statusPill} ${running ? styles.blue : percent === 100 ? styles.good : styles.warn}`}>{running ? `${percent}%` : progress.total && percent === 100 ? "เสร็จแล้ว" : "รอเริ่ม"}</span></div><div className={styles.testProgress}><span style={{ width: `${percent}%` }} /></div><div className={styles.testCardGrid}>{items.map((item) => <article className={`${styles.testCard} ${item.testStatus === "pass" ? styles.testCardPass : ""} ${item.testStatus === "blocked" || item.testStatus === "error" ? styles.testCardFail : ""}`} key={item.id}><div className={styles.testCardHeader}><div className={styles.testCardTitle}><strong title={titleOf(item)}>{titleOf(item)}</strong><span>{item.isSeries ? "ซีรีส์" : "หนัง"} · #{item.id}{item.isActive ? " · เปิดแสดง" : " · ซ่อน"}</span></div><span className={`${styles.statusPill} ${statusClass(item.testStatus)}`}>{statusLabels[item.testStatus]}</span></div><p className={styles.testCardUrl}>{item.playerPageUrl || "ไม่มี player_page_url"}</p><p className={styles.testCardDetail}>{item.detail || "รอผลทดสอบ"}{item.checkedAt ? ` · ${new Date(item.checkedAt).toLocaleTimeString("th-TH")}` : ""}</p></article>)}</div></section>}{!loading && !items.length && !error && <div className={styles.empty}>ไม่พบรายการในคลัง</div>}</AdminShell>;
}
