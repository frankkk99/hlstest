"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminShell from "../admin-shell";
import styles from "../admin.module.css";

type Overview = {
  configured: boolean;
  activeTitles: number;
  hiddenTitles: number;
  readyTitles: number;
  noPlayerTitles: number;
  brokenTitles: number;
  unknownTitles: number;
  movieTitles: number;
  seriesTitles: number;
  sourceCount: number;
  sourceStatus: Record<string, number>;
  lastCheckedAt: string;
};

const emptyOverview: Overview = {
  configured: false,
  activeTitles: 0,
  hiddenTitles: 0,
  readyTitles: 0,
  noPlayerTitles: 0,
  brokenTitles: 0,
  unknownTitles: 0,
  movieTitles: 0,
  seriesTitles: 0,
  sourceCount: 0,
  sourceStatus: {},
  lastCheckedAt: "",
};

export default function MissavAdminPage() {
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const data = (await response.json()) as { ok?: boolean; error?: string; overview?: Overview };
      if (!response.ok || !data.ok || !data.overview) {
        throw new Error(data.error || "อ่านข้อมูลภาพรวม MISSAV ไม่สำเร็จ");
      }
      setOverview(data.overview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "อ่านข้อมูลภาพรวม MISSAV ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const readyPercent = useMemo(
    () => (overview.activeTitles ? Math.round((overview.readyTitles / overview.activeTitles) * 100) : 0),
    [overview],
  );
  const sourceTotal = Math.max(1, overview.sourceCount);

  return (
    <AdminShell
      title="MISSAV Operations"
      description="จัดการ catalog, Player health และการเผยแพร่ของ MISSAV โดยไม่ปะปนกับ pipeline ของ AVDBAPI"
    >
      {loading ? (
        <div className={styles.loading}>กำลังอ่านสถานะ MISSAV จากฐานข้อมูล...</div>
      ) : error ? (
        <div className={styles.error}>
          {error} <button className={styles.button} type="button" onClick={() => void load()}>ลองใหม่</button>
        </div>
      ) : (
        <>
          <section className={styles.metricGrid}>
            <article className={styles.metric}><span>รายการเปิดใช้งาน</span><strong>{overview.activeTitles.toLocaleString()}</strong><small>MISSAV catalog</small></article>
            <article className={styles.metric}><span>พร้อมรับชม</span><strong className={styles.good}>{overview.readyTitles.toLocaleString()}</strong><small>{readyPercent}% ของรายการเปิดใช้งาน</small></article>
            <article className={styles.metric}><span>ไม่มี Player พร้อมใช้</span><strong className={styles.warn}>{overview.noPlayerTitles.toLocaleString()}</strong><small>ไม่ถูกส่งไปหน้าเว็บ</small></article>
            <article className={styles.metric}><span>Player มีปัญหา</span><strong className={styles.bad}>{overview.brokenTitles.toLocaleString()}</strong><small>blocked / error / expired</small></article>
            <article className={styles.metric}><span>ถูกซ่อน</span><strong className={styles.blue}>{overview.hiddenTitles.toLocaleString()}</strong><small>ไม่แสดงใน MISSAV</small></article>
            <article className={styles.metric}><span>Sources</span><strong>{overview.sourceCount.toLocaleString()}</strong><small>เฉพาะ MISSAV ระดับเรื่อง</small></article>
          </section>

          <section className={styles.sectionGrid}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><h2>MISSAV Workflow</h2><p>ทำงานกับคลังเดิมโดยตรง</p></div>
                <button className={styles.button} type="button" onClick={() => void load()}>รีเฟรช</button>
              </div>
              <div className={styles.linkGrid}>
                <Link className={styles.actionCard} href="/admin/catalog"><strong>จัดการรายการหนัง</strong><span>ค้นหา กรอง ซ่อน/แสดง และตรวจ source ของ MISSAV</span></Link>
                <Link className={styles.actionCard} href="/admin/test-all"><strong>ทดสอบ Player ทั้งหมด</strong><span>เช็ก Player สดโดยไม่แตะ AVDBAPI</span></Link>
                <Link className={styles.actionCard} href="/admin/health"><strong>Player Health</strong><span>ดู PASS, blocked, error, expired และ unknown</span></Link>
                <Link className={styles.actionCard} href="/admin/tools"><strong>เครื่องมือ MISSAV</strong><span>HLS Test, Bulk Test, Extractor และ Embed Test</span></Link>
                <Link className={styles.actionCard} href="/admin/system"><strong>ตรวจระบบ</strong><span>ดูสถานะฐานข้อมูลและเส้นทาง public ของ MISSAV</span></Link>
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}><div><h2>MISSAV Source Health</h2><p>นับจาก player_sources ระดับเรื่อง</p></div></div>
              <div className={styles.barList}>
                {[["pass", "PASS"], ["blocked", "BLOCKED"], ["error", "ERROR"], ["expired", "EXPIRED"], ["unknown", "UNKNOWN"]].map(([key, label]) => (
                  <div className={styles.barRow} key={key}>
                    <span>{label}</span>
                    <div className={styles.barTrack}><span style={{ width: `${Math.min(100, ((overview.sourceStatus[key] || 0) / sourceTotal) * 100)}%` }} /></div>
                    <strong>{overview.sourceStatus[key] || 0}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.panel} style={{ marginTop: 14 }}>
            <div className={styles.panelHeader}>
              <div><h2>กติกาการเผยแพร่ MISSAV</h2><p>ระบบ public ใช้เฉพาะ source ที่ผ่านการตรวจแล้ว</p></div>
              <span className={`${styles.statusPill} ${styles.good}`}>LIVE</span>
            </div>
            <ul className={styles.list}>
              <li><span>แสดงบน /hub</span><strong>status = pass + player_page_url</strong></li>
              <li><span>Player ไม่ผ่าน</span><strong>ไม่แสดง</strong></li>
              <li><span>แอดมินซ่อนรายการ</span><strong>is_active = false</strong></li>
              <li><span>ข้อมูล AVDBAPI</span><strong>ไม่อ่าน / ไม่ merge</strong></li>
            </ul>
          </section>
        </>
      )}
    </AdminShell>
  );
}
