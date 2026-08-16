"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./avdb-admin.module.css";
import polish from "./admin-polish.module.css";

type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
type StageStatus = "discovered" | "staged" | "duplicate" | "player_check" | "player_ready" | "published" | "error";

type StageRun = {
  id: string;
  status: RunStatus;
  start_page: number;
  end_page: number;
  current_page: number;
  checkpoint_page: number | null;
  concurrency: number;
  retry_limit: number;
  pages_scanned: number;
  items_discovered: number;
  items_staged: number;
  duplicates_found: number;
  player_ready: number;
  published_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type StageItem = {
  id: string;
  run_id: string | null;
  source_page: number | null;
  source_page_url: string | null;
  api_url: string | null;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  year: string | null;
  quality: string | null;
  duration: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_page_url: string | null;
  player_provider: string | null;
  player_status: string;
  stage_status: StageStatus;
  last_error: string | null;
  updated_at: string;
};

type StageLog = {
  id: number;
  run_id: string | null;
  level: "debug" | "info" | "warn" | "error" | "success";
  step: string;
  message: string;
  created_at: string;
};

type AdminState = {
  configured: boolean;
  crawlerConnected: boolean;
  latestRun: StageRun | null;
  items: StageItem[];
  logs: StageLog[];
  stats: {
    discovered: number;
    staging: number;
    duplicates: number;
    playerReady: number;
    published: number;
    failed: number;
  };
};

const pipeline = [
  { key: "source", number: "01", title: "Source", note: "Crawler อ่าน AVDB API ทีละหน้าและ checkpoint ต่อเนื่อง" },
  { key: "staging", number: "02", title: "Staging", note: "พบรายการแล้วเขียนเข้าจุดพักทันที พร้อมจัดหมวดอัตโนมัติ" },
  { key: "duplicate", number: "03", title: "Duplicate", note: "เทียบ external id + code/slug/title ก่อนสร้างรายการใหม่" },
  { key: "player", number: "04", title: "Player Health", note: "ตรวจ Player แบบ serial เป็น health signal ไม่บังคับก่อน Publish" },
  { key: "publish", number: "05", title: "Publish", note: "Publish metadata + source แล้วหน้า Watch resolve Player สดตอนกดเล่น" },
] as const;

const tabDefs = [
  ["queue", "คิวทั้งหมด"],
  ["staging", "Staging"],
  ["duplicate", "รายการซ้ำ"],
  ["player", "Player Health"],
  ["published", "Published"],
] as const;

type TabKey = (typeof tabDefs)[number][0];

const fallbackLogs = [
  { id: -1, time: "SYSTEM", text: "AVDB Staging DB พร้อมใช้งาน", tone: "safe" },
  { id: -2, time: "SYSTEM", text: "Crawler Worker เชื่อมกับ scanner core แล้ว", tone: "safe" },
  { id: -3, time: "SYSTEM", text: "Player session cache ตั้งไว้ 30 นาที; forceFresh ยังใช้เป็น fallback ได้", tone: "info" },
  { id: -4, time: "SYSTEM", text: "MISSAV isolation เปิดอยู่ — AVDB ใช้ catalog แยก", tone: "safe" },
] as const;

function runProgress(run: StageRun | null) {
  if (!run) return 0;
  const total = Math.max(1, run.end_page - run.start_page + 1);
  return Math.max(0, Math.min(100, Math.round((run.pages_scanned / total) * 100)));
}

function statusLabel(status: RunStatus | undefined) {
  if (!status) return "IDLE";
  return status.toUpperCase();
}

function stageMatchesTab(item: StageItem, tab: TabKey) {
  if (tab === "queue") return true;
  if (tab === "staging") return ["discovered", "staged"].includes(item.stage_status);
  if (tab === "duplicate") return item.stage_status === "duplicate";
  if (tab === "player") return ["player_check", "player_ready"].includes(item.stage_status);
  return item.stage_status === "published";
}

function InitialSkeleton() {
  return (
    <main className={polish.skeletonPage} aria-label="กำลังโหลด AVDB Admin">
      <div className={polish.skeletonShell}>
        <div className={polish.skeletonBar} />
        <div className={polish.skeletonHero} />
        <div className={polish.skeletonStats}>
          {Array.from({ length: 6 }, (_, index) => <div className={polish.skeletonTile} key={index} />)}
        </div>
        <div className={polish.skeletonWork}>
          <div className={polish.skeletonPanel} />
          <div className={polish.skeletonSide}>
            <div className={polish.skeletonPanel} />
            <div className={polish.skeletonPanel} />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function AvdbAdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("queue");
  const [query, setQuery] = useState("");
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState("1");
  const [concurrency, setConcurrency] = useState("1");
  const [retry, setRetry] = useState("2");
  const [state, setState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/admin/avdb", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "อ่านสถานะ AVDB ไม่สำเร็จ");
      setState(payload as AdminState);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านสถานะ AVDB ไม่สำเร็จ");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = state?.latestRun || null;
  const progress = runProgress(run);
  const activeRun = Boolean(run && ["queued", "running", "paused"].includes(run.status));
  const canPause = Boolean(run && ["queued", "running"].includes(run.status));
  const canResume = run?.status === "paused";
  const startValid = Number(startPage) >= 1 && Number(endPage) >= Number(startPage) && Number(endPage) <= 10262;

  const tabCounts = useMemo(() => {
    const items = state?.items || [];
    return {
      queue: items.length,
      staging: items.filter((item) => ["discovered", "staged"].includes(item.stage_status)).length,
      duplicate: items.filter((item) => item.stage_status === "duplicate").length,
      player: items.filter((item) => ["player_check", "player_ready"].includes(item.stage_status)).length,
      published: items.filter((item) => item.stage_status === "published").length,
    };
  }, [state?.items]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (state?.items || []).filter((item) => {
      if (!stageMatchesTab(item, activeTab)) return false;
      if (!normalized) return true;
      return [item.movie_code, item.title, item.external_id, item.source_page_url, item.api_url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [activeTab, query, state?.items]);

  const activeLabel = useMemo(
    () => tabDefs.find(([key]) => key === activeTab)?.[1] ?? "คิวทั้งหมด",
    [activeTab],
  );

  const performAction = useCallback(
    async (body: Record<string, unknown>) => {
      setActionBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/admin/avdb/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "ทำรายการไม่สำเร็จ");
        setNotice(payload?.message || "บันทึกสถานะ AVDB แล้ว");
        await refresh(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ");
      } finally {
        setActionBusy(false);
      }
    },
    [refresh],
  );

  const createRun = () =>
    performAction({
      action: "start",
      startPage: Number(startPage),
      endPage: Number(endPage),
      concurrency: Number(concurrency),
      retryLimit: Number(retry),
    });

  const controlRun = (action: "pause" | "resume" | "checkpoint" | "cancel") => {
    if (!run) return;
    return performAction({
      action,
      runId: run.id,
      currentPage: run.current_page,
      checkpointPage: run.current_page,
    });
  };

  const pipelineState = (key: (typeof pipeline)[number]["key"]) => {
    if (key === "source") return state?.crawlerConnected ? { state: "READY", tone: "ready" } : { state: "OFFLINE", tone: "waiting" };
    if (key === "staging") return { state: "READY", tone: "ready" };
    if (key === "duplicate") return state?.stats.duplicates ? { state: "ACTIVE", tone: "ready" } : { state: "READY", tone: "ready" };
    if (key === "player") return state?.stats.playerReady ? { state: "ACTIVE", tone: "ready" } : { state: "READY", tone: "ready" };
    return state?.stats.published ? { state: "ACTIVE", tone: "ready" } : { state: "READY", tone: "ready" };
  };

  if (loading && !state) return <InitialSkeleton />;

  return (
    <main className={`${styles.page} ${polish.pagePad}`}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brandGroup}>
            <Link className={styles.brand} href="/admin/avdb">AVDB<span>OPS</span></Link>
            <span className={styles.modeBadge}><i /> {state?.crawlerConnected ? "SYSTEM READY" : "SAFE MODE"}</span>
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
            <p>Crawler → Staging → Duplicate → Player Health → Publish แยกเป็นขั้นชัดเจน หน้าเว็บ Public จะ resolve Player สดตอนผู้ใช้กดเล่น และ Browser Session ที่พร้อมใช้จะถูก cache 30 นาทีเพื่อลดเวลารอและลดการเปิด Chromium ซ้ำ</p>
          </div>
          <div className={styles.commandActions}>
            <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void refresh()}>รีเฟรช</button>
            <Link className={styles.secondaryButton} href="/admin/avdb-import-test">เปิด Source Lab</Link>
            <button className={styles.pauseButton} type="button" disabled={!canPause || actionBusy} onClick={() => void controlRun("pause")}>Pause</button>
            {canResume ? (
              <button className={styles.startButton} type="button" disabled={actionBusy} onClick={() => void controlRun("resume")}>Resume</button>
            ) : (
              <button className={styles.startButton} type="button" disabled={activeRun || !startValid || actionBusy} onClick={() => void createRun()}>เริ่ม Run</button>
            )}
          </div>
        </section>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}
        {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}

        <section className={`${styles.stats} ${polish.statsSix}`} aria-label="สถานะ AVDB">
          <article><span>DISCOVERED</span><strong>{state?.stats.discovered ?? 0}</strong><small>รายการที่พบทั้งหมด</small></article>
          <article><span>STAGING</span><strong>{state?.stats.staging ?? 0}</strong><small>รอขั้นถัดไป</small></article>
          <article><span>DUPLICATES</span><strong>{state?.stats.duplicates ?? 0}</strong><small>กันซ้ำอัตโนมัติ</small></article>
          <article><span>PLAYER READY</span><strong>{state?.stats.playerReady ?? 0}</strong><small>Health check ผ่าน</small></article>
          <article><span>PUBLISHED</span><strong>{state?.stats.published ?? 0}</strong><small>อยู่ Public Catalog</small></article>
          <article className={`${styles.healthStat} ${polish.cacheStat}`}><span>PLAYER CACHE</span><strong>30 MIN</strong><small>fresh fallback ยังทำงาน</small></article>
        </section>

        <section className={styles.pipelineSection}>
          <div className={styles.sectionHeading}>
            <div><p>PIPELINE</p><h2>สถานะการทำงาน</h2></div>
            <span className={styles.pipelineSummary}>{progress}% · {statusLabel(run?.status)}</span>
          </div>
          <div className={styles.pipeline}>
            {pipeline.map((step) => {
              const resolved = pipelineState(step.key);
              return (
                <article className={`${styles.step} ${styles[resolved.tone]}`} key={step.key}>
                  <div className={styles.stepTop}><span>{step.number}</span><b>{resolved.state}</b></div>
                  <h3>{step.title}</h3>
                  <p>{step.note}</p>
                  <div className={styles.stepProgress}><span /></div>
                </article>
              );
            })}
          </div>
        </section>

        <div className={styles.workGrid}>
          <section className={styles.mainColumn}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><p>SOURCE CONFIGURATION</p><h2>ช่วงหน้าที่ต้องการดึง</h2></div>
                <span className={styles.safeBadge}>SERIAL BROWSER WORKER</span>
              </div>

              <div className={styles.configGrid}>
                <label className={styles.wideField}>
                  <span>Base source</span>
                  <input value="https://avdbapi.com/" readOnly />
                </label>
                <label>
                  <span>เริ่มหน้าที่</span>
                  <input disabled={activeRun} inputMode="numeric" value={startPage} onChange={(event) => setStartPage(event.target.value.replace(/\D/g, ""))} />
                </label>
                <label>
                  <span>ถึงหน้าที่</span>
                  <input disabled={activeRun} inputMode="numeric" value={endPage} onChange={(event) => setEndPage(event.target.value.replace(/\D/g, ""))} />
                </label>
                <label>
                  <span>API concurrency</span>
                  <select disabled={activeRun} value={concurrency} onChange={(event) => setConcurrency(event.target.value)}>
                    <option value="1">1 รายการพร้อมกัน</option>
                    <option value="2">2 รายการพร้อมกัน</option>
                    <option value="3">3 รายการพร้อมกัน</option>
                  </select>
                </label>
                <label>
                  <span>Retry ต่อหน้า</span>
                  <select disabled={activeRun} value={retry} onChange={(event) => setRetry(event.target.value)}>
                    <option value="0">ไม่ Retry</option>
                    <option value="1">1 ครั้ง</option>
                    <option value="2">2 ครั้ง</option>
                    <option value="3">3 ครั้ง</option>
                  </select>
                </label>
              </div>

              <div className={styles.configFooter}>
                <div><span className={styles.dot} /> Worker: <strong>{state?.crawlerConnected ? "CONNECTED" : "OFFLINE"}</strong></div>
                <div>Staging: <strong>CONNECTED</strong></div>
                <div>Mode: <strong>1 PAGE / STEP</strong></div>
                <button type="button" disabled={activeRun || !startValid || actionBusy} onClick={() => void createRun()}>สร้าง Run และเริ่มดึง</button>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.queueHeader}>
                <div className={styles.tabs} role="tablist" aria-label="AVDB work queue">
                  {tabDefs.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === key}
                      className={activeTab === key ? styles.tabActive : ""}
                      onClick={() => setActiveTab(key)}
                    >
                      {label}<span>{tabCounts[key]}</span>
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
                <div><strong>{activeLabel}</strong><span>{filteredItems.length} รายการที่โหลดล่าสุด</span></div>
                <div className={styles.queueActions}>
                  <span className={polish.queueHint}>Player Console อยู่ขวาล่าง</span>
                  <span className={polish.queueHint}>Publish Console อยู่ซ้ายล่าง</span>
                  <button className={polish.refreshButton} type="button" disabled={loading} onClick={() => void refresh()}>รีเฟรชคิว</button>
                </div>
              </div>

              {filteredItems.length ? (
                <div className={styles.itemGrid}>
                  {filteredItems.map((item) => (
                    <article className={styles.itemCard} key={item.id}>
                      <div className={styles.itemThumb}>
                        {item.thumb_url || item.poster_url ? <img src={item.thumb_url || item.poster_url || ""} alt="" /> : <span>AVDB</span>}
                      </div>
                      <div className={styles.itemBody}>
                        <div className={styles.itemTop}><b>{item.movie_code || item.external_id || "NO CODE"}</b><span>{item.stage_status}</span></div>
                        <h3 className={polish.cardTitle3} title={item.title}>{item.title || "ยังไม่มีชื่อ"}</h3>
                        <p>{[item.year, item.quality, item.duration, item.player_provider].filter(Boolean).join(" · ") || "รอ metadata"}</p>
                        <small>Source page {item.source_page ?? "—"} · Player {item.player_status}</small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>AV</div>
                  <h3>{state?.items.length ? "ไม่มีรายการตรงกับตัวกรอง" : "พร้อมเริ่มดึง AVDB เข้า Staging"}</h3>
                  <p>{query ? `ไม่พบ “${query}” ใน ${activeLabel}` : "กำหนดช่วงหน้าแล้วกดสร้าง Run ข้อมูลที่พบจะขึ้นเป็นการ์ดหลังแต่ละหน้าสแกนเสร็จ โดยไม่ต้องรอทั้งชุด"}</p>
                  <Link href="/admin/avdb-import-test">เปิด Source Lab เพื่อทดสอบต้นทาง →</Link>
                </div>
              )}
            </article>
          </section>

          <aside className={styles.sideColumn}>
            <article className={styles.sidePanel}>
              <div className={styles.panelHeadingCompact}><p>RUN STATUS</p><span className={run?.status === "failed" ? styles.failBadge : styles.offBadge}>{statusLabel(run?.status)}</span></div>
              <div className={styles.runProgress}><span style={{ width: `${progress}%` }} /></div>
              <dl className={styles.statusList}>
                <div><dt>Range</dt><dd>{run ? `${run.start_page}-${run.end_page}` : "—"}</dd></div>
                <div><dt>Current page</dt><dd>{run?.current_page ?? "—"}</dd></div>
                <div><dt>Pages scanned</dt><dd>{run?.pages_scanned ?? 0}</dd></div>
                <div><dt>Items discovered</dt><dd>{run?.items_discovered ?? 0}</dd></div>
                <div><dt>New staged</dt><dd>{run?.items_staged ?? 0}</dd></div>
                <div><dt>Duplicates</dt><dd>{run?.duplicates_found ?? 0}</dd></div>
                <div><dt>Last checkpoint</dt><dd>{run?.checkpoint_page ?? "—"}</dd></div>
                <div><dt>Failures</dt><dd>{run?.failed_count ?? 0}</dd></div>
              </dl>
              {run?.last_error ? <p className={styles.inlineError}>{run.last_error}</p> : null}
              <div className={styles.runActions}>
                <button type="button" disabled={!run || actionBusy || !activeRun} onClick={() => void controlRun("checkpoint")}>Checkpoint</button>
                <button type="button" disabled={!run || actionBusy || !activeRun} onClick={() => void controlRun("cancel")}>Cancel Run</button>
              </div>
            </article>

            <article className={styles.sidePanel}>
              <div className={styles.panelHeadingCompact}><p>DATA RULES</p><span>ENFORCED</span></div>
              <ul className={styles.rules}>
                <li><i>01</i><span><b>AVDB only</b>Staging และ Public Catalog แยกจาก MISSAV</span></li>
                <li><i>02</i><span><b>Duplicate safe</b>external id + code/slug/title</span></li>
                <li><i>03</i><span><b>Auto category</b>ชื่อ/รหัส/คุณภาพ/เวลา จัดหมวดอัตโนมัติ</span></li>
                <li><i>04</i><span><b>Live playback</b>resolve Player สดตอนผู้ใช้กดเล่น</span></li>
                <li><i>05</i><span><b>30m cache</b>reuse session เดิมและ forceFresh เมื่อจำเป็น</span></li>
              </ul>
            </article>

            <article className={`${styles.sidePanel} ${styles.logPanel}`}>
              <div className={styles.panelHeadingCompact}><p>LIVE LOG</p><span>{state?.logs.length ? "DATABASE" : "SYSTEM"}</span></div>
              <div className={styles.logs}>
                {state?.logs.length
                  ? state.logs.slice(0, 18).map((entry) => (
                      <div className={styles.logLine} key={entry.id}>
                        <span>{new Date(entry.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                        <p className={styles[`log_${entry.level}`]}>{entry.message}</p>
                      </div>
                    ))
                  : fallbackLogs.map((entry) => (
                      <div className={styles.logLine} key={entry.id}>
                        <span>{entry.time}</span>
                        <p className={styles[`log_${entry.tone}`]}>{entry.text}</p>
                      </div>
                    ))}
              </div>
            </article>
          </aside>
        </div>

        <footer className={styles.footerNote}>
          <strong>CRAWLER + STAGING + LIVE PLAYBACK READY</strong>
          <span>Crawler ยังทำงานแบบ 1 หน้า/1 server request เพื่อไม่ให้ Chromium ซ้อนกัน Player Health เป็นเครื่องมือตรวจสุขภาพแยกจาก Publish และ Public Watch จะ resolve source สดพร้อม reuse Browser Session สูงสุด 30 นาที หาก session/source ใช้ไม่ได้ระบบยัง forceFresh แล้วลองใหม่ได้</span>
        </footer>
      </div>
    </main>
  );
}
