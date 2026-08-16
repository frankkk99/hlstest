"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./avdb-more-loader.module.css";

type MoreState = {
  ok: boolean;
  error?: string;
  highestSourcePage: number;
  nextPage: number;
  maxSourcePage: number;
  remainingPages: number;
  active: boolean;
  latestRun: {
    id: string;
    status: string;
    start_page: number;
    end_page: number;
    current_page: number;
    checkpoint_page: number | null;
    pages_scanned: number;
  } | null;
};

export default function AvdbMoreLoader() {
  const [state, setState] = useState<MoreState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/avdb/run-more", { cache: "no-store" });
      const payload = (await response.json()) as MoreState;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "อ่านสถานะดึงเพิ่มไม่สำเร็จ");
      setState(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านสถานะดึงเพิ่มไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!state || customStart) return;
    setCustomStart(String(state.nextPage));
    setCustomEnd(String(Math.min(state.maxSourcePage, state.nextPage + 49)));
  }, [customStart, state]);

  const latest = state?.latestRun || null;
  const progress = useMemo(() => {
    if (!latest) return 0;
    const total = Math.max(1, latest.end_page - latest.start_page + 1);
    return Math.max(0, Math.min(100, Math.round((latest.pages_scanned / total) * 100)));
  }, [latest]);

  async function start(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/avdb/run-more", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 1, retryLimit: 2, ...body }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "เริ่มดึงเพิ่มไม่สำเร็จ");
      setNotice(payload.message || "สร้าง Run ดึงเพิ่มแล้ว");
      setCustomStart("");
      setCustomEnd("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เริ่มดึงเพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || Boolean(state?.active) || !state || state.remainingPages <= 0;

  return (
    <section className={styles.wrap} aria-label="ดึง AVDB เพิ่ม">
      <div className={styles.head}>
        <div>
          <p>INCREMENTAL IMPORT</p>
          <h2>ดึงหนัง AVDB เพิ่ม</h2>
          <span>ระบบเริ่มต่อจากหน้าสูงสุดที่มีใน Staging และใช้ dedupe/checkpoint เดิม</span>
        </div>
        <div className={styles.headActions}>
          <Link href="/admin/avdb-html-import">HTML Import / ตรวจ / บันทึก</Link>
          <button type="button" onClick={() => void refresh()} disabled={busy}>รีเฟรช</button>
        </div>
      </div>

      <div className={styles.metrics}>
        <article><span>ดึงถึงหน้า</span><strong>{state?.highestSourcePage ?? "—"}</strong></article>
        <article><span>หน้าถัดไป</span><strong>{state?.nextPage ?? "—"}</strong></article>
        <article><span>เหลือ</span><strong>{state?.remainingPages?.toLocaleString() ?? "—"}</strong></article>
        <article><span>Run ล่าสุด</span><strong>{latest?.status?.toUpperCase() || "IDLE"}</strong></article>
      </div>

      {latest ? (
        <div className={styles.runBox}>
          <div><b>หน้า {latest.start_page}-{latest.end_page}</b><span>ตอนนี้ {latest.current_page} · checkpoint {latest.checkpoint_page ?? "—"}</span></div>
          <div className={styles.progress}><span style={{ width: `${progress}%` }} /></div>
          <b>{progress}%</b>
        </div>
      ) : null}

      <div className={styles.quick}>
        {[10, 50, 100].map((count) => (
          <button key={count} type="button" disabled={disabled} onClick={() => void start({ count })}>
            ดึงเพิ่ม {count} หน้า
          </button>
        ))}
      </div>

      <div className={styles.custom}>
        <label><span>เริ่มหน้า</span><input inputMode="numeric" value={customStart} onChange={(event) => setCustomStart(event.target.value.replace(/\D/g, ""))} /></label>
        <label><span>ถึงหน้า</span><input inputMode="numeric" value={customEnd} onChange={(event) => setCustomEnd(event.target.value.replace(/\D/g, ""))} /></label>
        <button
          type="button"
          disabled={disabled || !customStart || !customEnd || Number(customEnd) < Number(customStart)}
          onClick={() => void start({ startPage: Number(customStart), endPage: Number(customEnd) })}
        >
          ดึงช่วงที่เลือก
        </button>
      </div>

      {state?.active ? <p className={styles.info}>มี Run เดิมอยู่ ระบบจะไม่สร้าง Run ซ้อน ให้ Run เดิมจบหรือ Resume ต่อก่อน</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
