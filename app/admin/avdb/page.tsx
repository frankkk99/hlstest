"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./avdb-admin.module.css";

const pipeline = [
  { key: "source", number: "01", title: "Source", note: "อ่านรายการจากหน้าต้นทาง", state: "READY", tone: "ready" },
  { key: "staging", number: "02", title: "Staging", note: "พักข้อมูลดิบก่อนบันทึกจริง", state: "WAITING", tone: "waiting" },
  { key: "duplicate", number: "03", title: "Duplicate", note: "ตรวจ code / slug / title ซ้ำ", state: "WAITING", tone: "waiting" },
  { key: "player", number: "04", title: "Player", note: "ตรวจ link และสถานะ Player", state: "WAITING", tone: "waiting" },
  { key: "publish", number: "05", title: "Publish", note: "ส่งรายการที่ผ่านขึ้น AVDB catalog", state: "LOCKED", tone: "locked" },
] as const;

const logs = [
  { time: "SYSTEM", text: "AVDB Control Room พร้อมใช้งานในโหมด PRE-IMPORT", tone: "info" },
  { time: "SYSTEM", text: "Auto scan ปิดอยู่ — การเปิดหน้านี้จะไม่เรียก /api/avdb-scan", tone: "safe" },
  { time: "SYSTEM", text: "Staging storage ยังไม่เชื่อม จึงล็อก Start Import และ Publish ไว้", tone: "warn" },
  { time: "SYSTEM", text: "MISSAV isolation เปิดอยู่ — AVDB จะไม่ merge หรือเขียนทับ MISSAV", tone: "safe" },
] as const;

const tabs = [
  ["queue", "คิวทั้งหมด", "0"],
  ["staging", "Staging", "0"],
  ["duplicate", "รายการซ้ำ", "0"],
  ["player", "รอตรวจ Player", "0"],
  ["published", "Published", "0"],
] as const;

export default function AvdbAdminPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>("queue");
  const [query, setQuery] = useState("");
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState("");
  const [concurrency, setConcurrency] = useState("1");
  const [retry, setRetry] = useState("2");

  const activeLabel = useMemo(
    () => tabs.find(([key]) => key === activeTab)?.[1] ?? "คิวทั้งหมด",
    [activeTab],
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brandGroup}>
            <Link className={styles.brand} href="/admin/avdb">AVDB<span>OPS</span></Link>
            <span className={styles.modeBadge}><i /> PRE-IMPORT</span>
          </div>
          <nav className={styles.nav} aria-label="เมนู AVDBAPI Admin">
            <Link href="/admin">Control Rooms</Link>
            <Link className={styles.navActive} href="/admin/avdb">AVDB Admin</Link>
            <Link href="/admin/avdb-import-test">Source Lab</Link>
            <Link href="/avdb">Public ↗</Link>
          </nav>
        </header>

        <section className={styles.commandHeader}>
          <div>
            <p className={styles.eyebrow}>AVDBAPI / OPERATIONS CENTER</p>
            <h1>AVDB Control Room</h1>
            <p>จัดการ Source → Staging → Duplicate → Player → Publish จากที่เดียว โดยยังไม่เริ่มดึงข้อมูลจนกว่า Staging จะพร้อม</p>
          </div>
          <div className={styles.commandActions}>
            <Link className={styles.secondaryButton} href="/admin/avdb-import-test">เปิด Source Lab</Link>
            <button className={styles.pauseButton} type="button" disabled>Pause</button>
            <button className={styles.startButton} type="button" disabled title="ต้องเชื่อม AVDB Staging ก่อน">เริ่ม Import</button>
          </div>
        </section>

        <section className={styles.stats} aria-label="สถานะ AVDB">
          <article><span>DISCOVERED</span><strong>0</strong><small>ยังไม่เริ่ม scan</small></article>
          <article><span>STAGING</span><strong>0</strong><small>รอเชื่อม storage</small></article>
          <article><span>PLAYER READY</span><strong>0</strong><small>ยังไม่มีรายการตรวจ</small></article>
          <article><span>PUBLISHED</span><strong>0</strong><small>publish ถูกล็อก</small></article>
          <article className={styles.healthStat}><span>SYSTEM</span><strong>SAFE</strong><small>MISSAV isolated</small></article>
        </section>

        <section className={styles.pipelineSection}>
          <div className={styles.sectionHeading}>
            <div><p>PIPELINE</p><h2>สถานะการทำงาน</h2></div>
            <span className={styles.pipelineSummary}>0% · WAITING FOR STAGING</span>
          </div>
          <div className={styles.pipeline}>
            {pipeline.map((step) => (
              <article className={`${styles.step} ${styles[step.tone]}`} key={step.key}>
                <div className={styles.stepTop}><span>{step.number}</span><b>{step.state}</b></div>
                <h3>{step.title}</h3>
                <p>{step.note}</p>
                <div className={styles.stepProgress}><span /></div>
              </article>
            ))}
          </div>
        </section>

        <div className={styles.workGrid}>
          <section className={styles.mainColumn}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><p>SOURCE CONFIGURATION</p><h2>ช่วงหน้าที่ต้องการดึง</h2></div>
                <span className={styles.safeBadge}>MANUAL START ONLY</span>
              </div>

              <div className={styles.configGrid}>
                <label className={styles.wideField}>
                  <span>Base source</span>
                  <input value="https://avdbapi.com/" readOnly />
                </label>
                <label>
                  <span>เริ่มหน้าที่</span>
                  <input inputMode="numeric" value={startPage} onChange={(event) => setStartPage(event.target.value.replace(/\D/g, ""))} />
                </label>
                <label>
                  <span>ถึงหน้าที่</span>
                  <input inputMode="numeric" placeholder="กำหนดภายหลัง" value={endPage} onChange={(event) => setEndPage(event.target.value.replace(/\D/g, ""))} />
                </label>
                <label>
                  <span>Concurrency</span>
                  <select value={concurrency} onChange={(event) => setConcurrency(event.target.value)}>
                    <option value="1">1 เรื่องพร้อมกัน</option>
                    <option value="2">2 เรื่องพร้อมกัน</option>
                    <option value="3">3 เรื่องพร้อมกัน</option>
                  </select>
                </label>
                <label>
                  <span>Retry</span>
                  <select value={retry} onChange={(event) => setRetry(event.target.value)}>
                    <option value="1">1 ครั้ง</option>
                    <option value="2">2 ครั้ง</option>
                    <option value="3">3 ครั้ง</option>
                  </select>
                </label>
              </div>

              <div className={styles.configFooter}>
                <div><span className={styles.dot} /> Auto scan: <strong>OFF</strong></div>
                <div>Session mode: <strong>SAFE / SERIAL</strong></div>
                <button type="button" disabled>บันทึกและเริ่มดึง</button>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.queueHeader}>
                <div className={styles.tabs} role="tablist" aria-label="AVDB work queue">
                  {tabs.map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === key}
                      className={activeTab === key ? styles.tabActive : ""}
                      onClick={() => setActiveTab(key)}
                    >
                      {label}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <input
                  className={styles.search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ค้นหา code / title / source URL"
                  aria-label="ค้นหารายการ AVDB"
                />
              </div>

              <div className={styles.queueToolbar}>
                <div><strong>{activeLabel}</strong><span>0 รายการ</span></div>
                <div className={styles.queueActions}>
                  <button type="button" disabled>เลือกทั้งหมด</button>
                  <button type="button" disabled>ทดสอบ Player</button>
                  <button type="button" disabled>Publish ที่เลือก</button>
                </div>
              </div>

              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>AV</div>
                <h3>ยังไม่มีข้อมูล AVDB ในคิว</h3>
                <p>{query ? `ไม่พบ “${query}” เพราะยังไม่ได้เริ่ม import` : "เมื่อเริ่มดึงข้อมูล การ์ดที่พบจะขึ้นตรงนี้ทันทีโดยไม่ต้องรอให้ทั้งชุดเสร็จ"}</p>
                <Link href="/admin/avdb-import-test">ทดสอบต้นทาง 1 หน้าก่อน →</Link>
              </div>
            </article>
          </section>

          <aside className={styles.sideColumn}>
            <article className={styles.sidePanel}>
              <div className={styles.panelHeadingCompact}><p>RUN STATUS</p><span className={styles.offBadge}>STOPPED</span></div>
              <div className={styles.runProgress}><span /></div>
              <dl className={styles.statusList}>
                <div><dt>Current page</dt><dd>—</dd></div>
                <div><dt>Current item</dt><dd>—</dd></div>
                <div><dt>Session</dt><dd>Idle</dd></div>
                <div><dt>Last checkpoint</dt><dd>—</dd></div>
                <div><dt>Failures</dt><dd>0</dd></div>
              </dl>
            </article>

            <article className={styles.sidePanel}>
              <div className={styles.panelHeadingCompact}><p>DATA RULES</p><span>LOCKED</span></div>
              <ul className={styles.rules}>
                <li><i>01</i><span><b>AVDB only</b>ไม่เขียนทับ MISSAV</span></li>
                <li><i>02</i><span><b>Duplicate safe</b>รวมซ้ำภายใน AVDB เท่านั้น</span></li>
                <li><i>03</i><span><b>Staging first</b>ข้อมูลใหม่เข้าจุดพักก่อน</span></li>
                <li><i>04</i><span><b>Player verified</b>ผ่าน Player ก่อน Publish</span></li>
                <li><i>05</i><span><b>Checkpoint</b>รองรับหยุดและทำต่อภายหลัง</span></li>
              </ul>
            </article>

            <article className={`${styles.sidePanel} ${styles.logPanel}`}>
              <div className={styles.panelHeadingCompact}><p>LIVE LOG</p><span>PRE-IMPORT</span></div>
              <div className={styles.logs}>
                {logs.map((entry, index) => (
                  <div className={styles.logLine} key={`${entry.time}-${index}`}>
                    <span>{entry.time}</span>
                    <p className={styles[`log_${entry.tone}`]}>{entry.text}</p>
                  </div>
                ))}
              </div>
            </article>
          </aside>
        </div>

        <footer className={styles.footerNote}>
          <strong>PRE-IMPORT SAFETY LOCK</strong>
          <span>หน้า Admin พร้อมสำหรับ workflow แล้ว แต่ยังไม่มีคำสั่งใดเริ่มดึง AVDBAPI โดยอัตโนมัติ ขั้นต่อไปคือสร้าง AVDB Staging และ API สำหรับ Start / Pause / Resume / Checkpoint</span>
        </footer>
      </div>
    </main>
  );
}
