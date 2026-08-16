"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./avdb-player-console.module.css";

type PlayerState = {
  ok: boolean;
  stats: { pending: number; checking: number; ready: number; failed: number; blocked: number };
  recent: Array<{
    id: string;
    movie_code: string | null;
    title: string;
    player_status: string;
    stage_status: string;
    player_checked_at: string | null;
    player_failure_type: string | null;
    last_error: string | null;
  }>;
  latestRun: { id: string; status: string; current_page: number; end_page: number } | null;
  crawlerActive: boolean;
};

type BatchState = {
  running: boolean;
  includeFailed: boolean;
};

const BATCH_KEY = "hlstest:avdb-player-batch";
const LOCK_KEY = "hlstest:avdb-player-lock";
const LOCK_TTL = 90_000;

function readBatch(): BatchState {
  try {
    const raw = window.localStorage.getItem(BATCH_KEY);
    if (!raw) return { running: false, includeFailed: false };
    const parsed = JSON.parse(raw) as Partial<BatchState>;
    return { running: parsed.running === true, includeFailed: parsed.includeFailed === true };
  } catch {
    return { running: false, includeFailed: false };
  }
}

function writeBatch(value: BatchState) {
  try {
    window.localStorage.setItem(BATCH_KEY, JSON.stringify(value));
  } catch {
    // Local state still works even if storage is unavailable.
  }
}

function ownerId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function claimLock(owner: string) {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (raw) {
      const current = JSON.parse(raw) as { owner?: string; expiresAt?: number };
      if (current.owner && current.owner !== owner && Number(current.expiresAt) > Date.now()) return false;
    }
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt: Date.now() + LOCK_TTL }));
  } catch {
    // busyRef serializes the current tab if storage is unavailable.
  }
  return true;
}

function releaseLock(owner: string) {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (!raw) return;
    const current = JSON.parse(raw) as { owner?: string };
    if (!current.owner || current.owner === owner) window.localStorage.removeItem(LOCK_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export default function AvdbPlayerConsole() {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<PlayerState | null>(null);
  const [batch, setBatch] = useState<BatchState>({ running: false, includeFailed: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const ownerRef = useRef("");
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/avdb/player", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "อ่านสถานะ Player ไม่สำเร็จ");
      setState(payload as PlayerState);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านสถานะ Player ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    ownerRef.current = ownerId();
    setBatch(readBatch());
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      window.clearInterval(timer);
      releaseLock(ownerRef.current);
    };
  }, [refresh]);

  const setBatchState = useCallback((next: BatchState) => {
    writeBatch(next);
    setBatch(next);
  }, []);

  const verifyStep = useCallback(async (includeFailed: boolean) => {
    const response = await fetch("/api/admin/avdb/player/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeFailed }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "ตรวจ Player ไม่สำเร็จ");
    return payload as { ok: boolean; done?: boolean; continue?: boolean; result?: { movieCode?: string | null; title?: string; playerStatus?: string; error?: string | null } | null };
  }, []);

  useEffect(() => {
    if (!batch.running) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || busyRef.current || !batch.running) return;
      if (state?.crawlerActive) {
        setNotice("Crawler ยังทำงานอยู่ — Player batch จะรอจน Crawler จบหรือ Pause");
        return;
      }
      if (!claimLock(ownerRef.current)) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const payload = await verifyStep(batch.includeFailed);
        if (payload.done || payload.continue === false) {
          setBatchState({ running: false, includeFailed: batch.includeFailed });
          setNotice("ตรวจ Player ในคิวครบแล้ว");
          releaseLock(ownerRef.current);
        } else if (payload.result) {
          const label = payload.result.movieCode || payload.result.title || "รายการล่าสุด";
          setNotice(`${label}: ${payload.result.playerStatus === "ready" ? "READY" : "FAILED"}`);
        }
        await refresh();
      } catch (cause) {
        setBatchState({ running: false, includeFailed: batch.includeFailed });
        setError(cause instanceof Error ? cause.message : "Player batch หยุดจากข้อผิดพลาด");
        releaseLock(ownerRef.current);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [batch, refresh, setBatchState, state?.crawlerActive, verifyStep]);

  const runOne = async () => {
    if (state?.crawlerActive) return;
    setBusy(true);
    setError("");
    try {
      const payload = await verifyStep(false);
      if (payload.done) setNotice("ไม่มีรายการ unverified เหลือแล้ว");
      else if (payload.result) {
        const label = payload.result.movieCode || payload.result.title || "รายการล่าสุด";
        setNotice(`${label}: ${payload.result.playerStatus === "ready" ? "READY" : "FAILED"}`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตรวจ Player ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const counts = state?.stats || { pending: 0, checking: 0, ready: 0, failed: 0, blocked: 0 };
  const recent = useMemo(() => state?.recent.slice(0, 6) || [], [state?.recent]);
  const locked = Boolean(state?.crawlerActive);

  return (
    <aside className={`${styles.console} ${open ? styles.open : styles.closed}`} aria-label="AVDB Player Verification">
      <button className={styles.handle} type="button" onClick={() => setOpen((value) => !value)}>
        <span><i className={batch.running ? styles.liveDot : styles.dot} /> PLAYER VERIFY</span>
        <b>{counts.ready}/{counts.ready + counts.pending + counts.failed + counts.checking}</b>
      </button>

      {open ? (
        <div className={styles.body}>
          <div className={styles.heading}>
            <div>
              <small>AVDB / PLAYER GATE</small>
              <strong>{batch.running ? "กำลังตรวจ Player" : locked ? "รอ Crawler" : "พร้อมตรวจ"}</strong>
            </div>
            <span>{locked ? "LOCKED" : batch.running ? "RUNNING" : "READY"}</span>
          </div>

          <div className={styles.metrics}>
            <div><span>PENDING</span><b>{counts.pending}</b></div>
            <div><span>READY</span><b>{counts.ready}</b></div>
            <div><span>FAILED</span><b>{counts.failed}</b></div>
            <div><span>CHECKING</span><b>{counts.checking}</b></div>
          </div>

          {locked ? <p className={styles.warning}>Crawler ยังทำงานอยู่ ระบบล็อก Player Verification เพื่อไม่ให้ Chromium ชนกัน</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          <div className={styles.actions}>
            <button type="button" disabled={locked || busy || batch.running || counts.pending < 1} onClick={() => void runOne()}>
              ตรวจถัดไป 1 เรื่อง
            </button>
            <button
              className={styles.primary}
              type="button"
              disabled={locked || batch.running || counts.pending < 1}
              onClick={() => {
                setError("");
                setNotice("เริ่มตรวจ Player ทั้งคิวแบบ serial");
                setBatchState({ running: true, includeFailed: false });
              }}
            >
              ตรวจทั้งหมด
            </button>
            <button
              type="button"
              disabled={locked || batch.running || counts.failed < 1}
              onClick={() => {
                setError("");
                setNotice("เริ่ม Retry รายการที่ Player ไม่ผ่าน");
                setBatchState({ running: true, includeFailed: true });
              }}
            >
              Retry Failed
            </button>
            <button
              className={styles.stop}
              type="button"
              disabled={!batch.running}
              onClick={() => {
                setBatchState({ running: false, includeFailed: batch.includeFailed });
                setNotice("หยุด Player batch แล้ว");
                releaseLock(ownerRef.current);
              }}
            >
              หยุด
            </button>
          </div>

          <div className={styles.recent}>
            <div className={styles.recentTitle}><span>ล่าสุด</span><small>manifest + first segment</small></div>
            {recent.length ? recent.map((item) => (
              <div className={styles.row} key={item.id}>
                <div>
                  <b>{item.movie_code || item.title || "NO CODE"}</b>
                  <span>{item.player_failure_type || item.stage_status}</span>
                </div>
                <strong className={styles[`status_${item.player_status}`] || ""}>{item.player_status.toUpperCase()}</strong>
              </div>
            )) : <p className={styles.empty}>ยังไม่มีผลตรวจ Player</p>}
          </div>

          <p className={styles.footer}>ผ่านเมื่อ Browser Session จับ HLS ได้ และตรวจ manifest + segment แรกสำเร็จเท่านั้น · Publish ยังปิดอยู่</p>
        </div>
      ) : null}
    </aside>
  );
}
