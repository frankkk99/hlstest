"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./avdb-publish-console.module.css";

type PublishState = {
  ok: boolean;
  readyToPublish: number;
  published: number;
  recent: Array<{
    id: string;
    stage_item_id: string;
    movie_code: string | null;
    title: string;
    player_provider: string | null;
    published_at: string;
    is_active: boolean;
  }>;
};

const BATCH_KEY = "hlstest:avdb-publish-batch";

export default function AvdbPublishConsole() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PublishState | null>(null);
  const [batch, setBatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const stoppedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/avdb/publish", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "อ่านสถานะ Publish ไม่สำเร็จ");
      setState(payload as PublishState);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านสถานะ Publish ไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(BATCH_KEY) === "1") setBatch(true);
    } catch {}
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      stoppedRef.current = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const setBatchState = useCallback((value: boolean) => {
    setBatch(value);
    try {
      if (value) window.localStorage.setItem(BATCH_KEY, "1");
      else window.localStorage.removeItem(BATCH_KEY);
    } catch {}
  }, []);

  const publishBatch = useCallback(async (limit = 50) => {
    const response = await fetch("/api/admin/avdb/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish_batch", limit }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Publish ไม่สำเร็จ");
    return payload as { published: number; remaining: number };
  }, []);

  useEffect(() => {
    if (!batch) return;
    stoppedRef.current = false;
    let cancelled = false;

    async function tick() {
      if (cancelled || stoppedRef.current || busyRef.current || !batch) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await publishBatch(50);
        setNotice(`Publish ${result.published} รายการ · เหลือ ${result.remaining}`);
        await refresh();
        if (result.remaining < 1 || result.published < 1) {
          setBatchState(false);
          setNotice("Publish รายการที่ผ่าน Player Gate ครบแล้ว");
        }
      } catch (cause) {
        setBatchState(false);
        setError(cause instanceof Error ? cause.message : "Publish batch หยุดจากข้อผิดพลาด");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), 1100);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [batch, publishBatch, refresh, setBatchState]);

  const publishOne = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await publishBatch(1);
      setNotice(result.published ? `Publish 1 รายการแล้ว · เหลือ ${result.remaining}` : "ไม่มีรายการที่ผ่าน Player Gate รอ Publish");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publish ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async (catalogId: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/avdb/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish", catalogId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Unpublish ไม่สำเร็จ");
      setNotice("นำรายการออกจากหน้า AVDB แล้ว และคืนกลับไปสถานะ Player Ready");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unpublish ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const ready = state?.readyToPublish || 0;
  const published = state?.published || 0;

  return (
    <aside className={`${styles.console} ${open ? "" : styles.closed}`} aria-label="AVDB Publish Gate">
      <button className={styles.handle} type="button" onClick={() => setOpen((value) => !value)}>
        <span><i className={batch ? styles.liveDot : styles.dot} /> PUBLISH GATE</span>
        <b>{ready} READY</b>
      </button>

      {open ? (
        <div className={styles.body}>
          <div className={styles.heading}>
            <div><small>AVDB / PUBLIC CATALOG</small><strong>{batch ? "กำลัง Publish" : "Manual Gate"}</strong></div>
            <span>{batch ? "RUNNING" : "SAFE"}</span>
          </div>

          <div className={styles.metrics}>
            <div><span>READY TO PUBLISH</span><b>{ready}</b></div>
            <div><span>PUBLIC CATALOG</span><b>{published}</b></div>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          <div className={styles.actions}>
            <button type="button" disabled={busy || batch || ready < 1} onClick={() => void publishOne()}>Publish ถัดไป 1</button>
            <button className={styles.primary} type="button" disabled={busy || batch || ready < 1} onClick={() => { setNotice("เริ่ม Publish เฉพาะรายการ Player Ready"); setBatchState(true); }}>Publish พร้อมทั้งหมด</button>
            <button className={styles.stop} type="button" disabled={!batch} onClick={() => { stoppedRef.current = true; setBatchState(false); setNotice("หยุด Publish batch แล้ว"); }}>หยุด</button>
            <button type="button" disabled={busy} onClick={() => void refresh()}>รีเฟรชสถานะ</button>
          </div>

          <div className={styles.recent}>
            <div className={styles.recentTitle}><span>Public ล่าสุด</span><small>เฉพาะ catalog แยก</small></div>
            {state?.recent?.length ? state.recent.slice(0, 6).map((item) => (
              <div className={styles.row} key={item.id}>
                <div>
                  <b>{item.movie_code || item.title}</b>
                  <span>{item.player_provider || "verified"} · {item.is_active ? "PUBLIC" : "HIDDEN"}</span>
                </div>
                {item.is_active ? <button type="button" disabled={busy || batch} onClick={() => void unpublish(item.id)}>Unpublish</button> : null}
              </div>
            )) : <p className={styles.empty}>ยังไม่มีรายการใน AVDB Public Catalog</p>}
          </div>

          <p className={styles.footer}>Publish ได้เฉพาะ player ready + stage player_ready และมี verified media จาก Player Gate เท่านั้น</p>
        </div>
      ) : null}
    </aside>
  );
}
