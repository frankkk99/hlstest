"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./import-console.module.css";

type PreviewItem = {
  id: string;
  movieCode: string;
  title: string;
  originalTitle: string;
  year: string;
  quality: string;
  duration: string;
  description: string;
  thumbUrl: string;
  posterUrl: string;
  playerProvider: string | null;
  hasPlayer: boolean;
  saved: boolean;
  stageItemId: string | null;
  stageStatus: string | null;
  playerStatus: string | null;
};

type CardItem = PreviewItem & {
  sourceName: string;
  sourcePage: number | null;
  testState: "idle" | "testing" | "pass" | "fail";
  testMessage: string;
  playbackUrl: string;
  saveState: "idle" | "saving" | "saved" | "error";
  saveMessage: string;
};

type ApiError = { id: string; error: string };

type PreviewResponse = {
  ok: boolean;
  error?: string;
  requested: number;
  fetched: number;
  failed: number;
  errors?: ApiError[];
  items?: PreviewItem[];
};

type SaveResponse = PreviewResponse & {
  inserted: number;
  updated: number;
  duplicates: number;
  message?: string;
};

type TestResponse = {
  ok: boolean;
  error?: string;
  result?: {
    ok: boolean;
    provider?: string | null;
    cache?: string;
    playbackUrl?: string;
    expiresAt?: number;
    failureType?: string;
    error?: string;
  };
};

type SourceInput = { name: string; text: string };
type PreparedSource = SourceInput & { ids: string[]; page: number | null };

const BATCH_SIZE = 12;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function normalizeSource(value: string) {
  return value.replace(/\\&/g, "&").replace(/&amp;/gi, "&").replace(/\\\//g, "/");
}

function extractAvdbIds(raw: string) {
  const text = normalizeSource(raw);
  const ids = new Set<string>();
  const patterns = [
    /[?&]ids=(\d{1,12})/gi,
    /data-vod-id=["'](\d{1,12})["']/gi,
    /data-clipboard-text=["'][^"']*[?&]ids=(\d{1,12})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) ids.add(match[1]);
  }
  return [...ids];
}

function detectSourcePage(name: string, raw: string) {
  const fromName = name.match(/(?:index|page)[-_ ]?(\d{1,6})/i);
  if (fromName) return Number(fromName[1]);
  const text = normalizeSource(raw);
  const currentHref = text.match(/index-(\d{1,6})\/[^>]{0,220}aria-current=["']page["']/i);
  if (currentHref) return Number(currentHref[1]);
  const currentText = text.match(/aria-current=["']page["'][^>]*>\s*(\d{1,6})/i);
  if (currentText) return Number(currentText[1]);
  return null;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function initialCard(item: PreviewItem, source: { name: string; page: number | null }): CardItem {
  return {
    ...item,
    sourceName: source.name,
    sourcePage: source.page,
    testState: item.playerStatus === "verified" || item.playerStatus === "ready" ? "pass" : "idle",
    testMessage: "",
    playbackUrl: "",
    saveState: item.saved ? "saved" : "idle",
    saveMessage: item.saved ? item.stageStatus || "บันทึกแล้ว" : "",
  };
}

export default function AvdbHtmlImportConsole() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardsRef = useRef<CardItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState("");
  const [cards, setCards] = useState<CardItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewProgress, setPreviewProgress] = useState({ processed: 0, total: 0, failed: 0 });
  const [playerCard, setPlayerCard] = useState<CardItem | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unsaved" | "passed" | "failed" | "saved">("all");

  const pasteCount = useMemo(() => extractAvdbIds(paste).length, [paste]);
  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((item) => {
      if (filter === "unsaved" && item.saveState === "saved") return false;
      if (filter === "passed" && item.testState !== "pass") return false;
      if (filter === "failed" && item.testState !== "fail") return false;
      if (filter === "saved" && item.saveState !== "saved") return false;
      if (!q) return true;
      return [item.id, item.movieCode, item.title, item.originalTitle, item.playerProvider]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [cards, filter, query]);

  const stats = useMemo(() => ({
    total: cards.length,
    passed: cards.filter((item) => item.testState === "pass").length,
    failed: cards.filter((item) => item.testState === "fail").length,
    saved: cards.filter((item) => item.saveState === "saved").length,
    unsaved: cards.filter((item) => item.saveState !== "saved").length,
  }), [cards]);

  function updateCards(updater: (current: CardItem[]) => CardItem[]) {
    setCards((current) => {
      const next = updater(current);
      cardsRef.current = next;
      return next;
    });
  }

  function patchCard(id: string, patch: Partial<CardItem>) {
    updateCards((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function prepareSources(sources: SourceInput[]) {
    const seen = new Set<string>();
    return sources.map((source): PreparedSource => {
      const ids = extractAvdbIds(source.text).filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return { ...source, ids, page: detectSourcePage(source.name, source.text) };
    });
  }

  async function previewBatch(ids: string[]) {
    const response = await fetch("/api/admin/avdb/import-html/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      cache: "no-store",
    });
    const payload = (await response.json()) as PreviewResponse;
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Preview AVDB ไม่สำเร็จ");
    return payload;
  }

  async function previewSources(sources: SourceInput[]) {
    setBusy(true);
    setError("");
    setNotice("");
    setPlayerCard(null);
    try {
      const prepared = prepareSources(sources);
      const sourceById = new Map<string, { name: string; page: number | null }>();
      for (const source of prepared) for (const id of source.ids) sourceById.set(id, { name: source.name, page: source.page });
      const ids = [...sourceById.keys()];
      if (!ids.length) throw new Error("ไม่พบ AVDB ID/API detail link ในข้อมูลที่ให้มา");

      setPreviewProgress({ processed: 0, total: ids.length, failed: 0 });
      const collected: CardItem[] = [];
      let failed = 0;
      for (const batch of chunks(ids, BATCH_SIZE)) {
        const payload = await previewBatch(batch);
        failed += payload.failed || 0;
        for (const item of payload.items || []) {
          const source = sourceById.get(item.id) || { name: "pasted-source", page: null };
          collected.push(initialCard(item, source));
        }
        const processed = Math.min(ids.length, collected.length + failed);
        setPreviewProgress({ processed, total: ids.length, failed });
      }
      collected.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
      cardsRef.current = collected;
      setCards(collected);
      setNotice(`Preview พร้อม ${collected.length}/${ids.length} เรื่อง · ยังไม่บันทึกข้อมูลใหม่จนกว่าจะกดบันทึก`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview AVDB ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function previewFiles() {
    if (!files.length) return;
    if (files.length > MAX_FILES) return setError(`เลือกได้สูงสุด ${MAX_FILES} ไฟล์ต่อรอบ`);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) return setError(`${oversized.name} ใหญ่เกิน 4 MB กรุณาแยกไฟล์`);
    const sources: SourceInput[] = [];
    for (const file of files) sources.push({ name: file.name, text: await file.text() });
    await previewSources(sources);
  }

  async function testOne(id: string, forceFresh = false) {
    const card = cardsRef.current.find((item) => item.id === id);
    if (!card || card.testState === "testing") return false;
    patchCard(id, { testState: "testing", testMessage: "กำลังตรวจ Player…", playbackUrl: "" });
    try {
      const response = await fetch("/api/admin/avdb/import-html/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, forceFresh }),
        cache: "no-store",
      });
      const payload = (await response.json()) as TestResponse;
      if (!response.ok || !payload.ok || !payload.result) throw new Error(payload.error || "ตรวจ Player ไม่สำเร็จ");
      if (!payload.result.ok) {
        patchCard(id, { testState: "fail", testMessage: payload.result.error || "Player ไม่ผ่าน", playbackUrl: "" });
        return false;
      }
      patchCard(id, {
        testState: "pass",
        testMessage: `Player ผ่าน${payload.result.cache ? ` · cache ${payload.result.cache}` : ""}`,
        playbackUrl: payload.result.playbackUrl || "",
      });
      return true;
    } catch (cause) {
      patchCard(id, { testState: "fail", testMessage: cause instanceof Error ? cause.message : "ตรวจ Player ไม่สำเร็จ", playbackUrl: "" });
      return false;
    }
  }

  async function saveBatch(items: CardItem[]) {
    if (!items.length) return;
    for (const item of items) patchCard(item.id, { saveState: "saving", saveMessage: "กำลังบันทึก…" });
    const response = await fetch("/api/admin/avdb/import-html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: items.map((item) => item.id),
        sourceName: items[0]?.sourceName || "html-import-console",
        sourcePage: items[0]?.sourcePage ?? null,
      }),
      cache: "no-store",
    });
    const payload = (await response.json()) as SaveResponse;
    if (!response.ok || !payload.ok) {
      const message = payload.error || "บันทึกไม่สำเร็จ";
      for (const item of items) patchCard(item.id, { saveState: "error", saveMessage: message });
      throw new Error(message);
    }
    const returned = new Map((payload.items || []).map((item) => [item.id, item]));
    const failed = new Map((payload.errors || []).map((item) => [item.id, item.error]));
    for (const item of items) {
      const saved = returned.get(item.id);
      if (!saved) {
        patchCard(item.id, {
          saveState: "error",
          saveMessage: failed.get(item.id) || "API detail ไม่พร้อม จึงยังไม่ได้บันทึก",
        });
        continue;
      }
      patchCard(item.id, {
        saveState: "saved",
        saveMessage: saved.stageStatus || "บันทึกแล้ว",
        saved: true,
        stageItemId: saved.stageItemId || item.stageItemId,
        stageStatus: saved.stageStatus || item.stageStatus || "staged",
        playerStatus: saved.playerStatus || item.playerStatus,
      });
    }
  }

  async function saveOne(id: string) {
    const item = cardsRef.current.find((entry) => entry.id === id);
    if (!item || item.saveState === "saving") return false;
    try {
      await saveBatch([item]);
      return cardsRef.current.find((entry) => entry.id === id)?.saveState === "saved";
    } catch {
      return false;
    }
  }

  async function testAndSave(id: string) {
    const passed = await testOne(id, false);
    if (passed) await saveOne(id);
  }

  async function testAll() {
    setBulkBusy("test");
    setError("");
    try {
      for (const item of [...cardsRef.current]) {
        if (!item.hasPlayer) {
          patchCard(item.id, { testState: "fail", testMessage: "ไม่มี Player URL" });
          continue;
        }
        await testOne(item.id, false);
      }
      setNotice("ทดสอบ Player ทั้งหมดแบบ serial เสร็จแล้ว");
    } finally {
      setBulkBusy("");
    }
  }

  async function saveMany(items: CardItem[]) {
    const groups = new Map<string, CardItem[]>();
    for (const item of items.filter((entry) => entry.saveState !== "saved")) {
      const key = `${item.sourceName}::${item.sourcePage ?? ""}`;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }
    for (const group of groups.values()) {
      for (const batch of chunks(group, BATCH_SIZE)) await saveBatch(batch);
    }
  }

  async function saveAll(mode: "all" | "passed") {
    setBulkBusy(mode === "passed" ? "save-passed" : "save-all");
    setError("");
    try {
      const source = cardsRef.current.filter((item) => mode === "all" || item.testState === "pass");
      await saveMany(source);
      setNotice(mode === "passed" ? "บันทึกเฉพาะรายการที่ Player ผ่านแล้ว" : "บันทึกรายการทั้งหมดแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกแบบชุดไม่สำเร็จ");
    } finally {
      setBulkBusy("");
    }
  }

  function openPlayer(id: string) {
    const item = cardsRef.current.find((entry) => entry.id === id);
    if (item?.playbackUrl) setPlayerCard(item);
  }

  const progress = previewProgress.total ? Math.round((previewProgress.processed / previewProgress.total) * 100) : 0;

  return (
    <div className={styles.console}>
      <section className={styles.inputPanel}>
        <div className={styles.panelHead}>
          <div><p>SOURCE INPUT</p><h2>วาง HTML หรืออัปโหลดหน้าที่บันทึกไว้</h2><span>ขั้นนี้อ่าน ID และ API detail เพื่อ Preview เท่านั้น ยังไม่เขียนลง Staging</span></div>
          <span className={styles.safe}>PREVIEW FIRST</span>
        </div>

        <div className={styles.inputGrid}>
          <div className={styles.uploadBox}>
            <input ref={inputRef} type="file" multiple accept=".html,.htm,.md,.txt,text/html,text/plain,text/markdown" hidden onChange={(event) => setFiles(Array.from(event.target.files || []))} />
            <button type="button" className={styles.pickButton} disabled={busy} onClick={() => inputRef.current?.click()}>เลือกไฟล์</button>
            <strong>{files.length ? `${files.length} ไฟล์` : "รองรับหลายไฟล์"}</strong>
            <small>.html / .htm / .md / .txt · สูงสุด 50 ไฟล์</small>
            {files.length ? <div className={styles.fileList}>{files.slice(0, 8).map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div> : null}
            <button type="button" className={styles.primary} disabled={busy || !files.length} onClick={() => void previewFiles()}>{busy ? "กำลังอ่าน…" : "Preview จากไฟล์"}</button>
          </div>

          <div className={styles.pasteBox}>
            <label htmlFor="avdb-html-source">HTML / View Source / Markdown</label>
            <textarea id="avdb-html-source" value={paste} disabled={busy} onChange={(event) => setPaste(event.target.value)} placeholder="วาง source ของหน้า AVDB ที่เปิดได้ตรงนี้…" />
            <div><span>ตรวจพบ {pasteCount.toLocaleString()} ID</span><button type="button" disabled={busy || !pasteCount} onClick={() => void previewSources([{ name: "pasted-avdb-source", text: paste }])}>Preview</button></div>
          </div>
        </div>

        {previewProgress.total ? <div className={styles.progressBox}><div><span>อ่าน API detail {previewProgress.processed}/{previewProgress.total}</span><b>{progress}%</b></div><div className={styles.progress}><span style={{ width: `${progress}%` }} /></div>{previewProgress.failed ? <small>API ไม่ผ่าน {previewProgress.failed} ID</small> : null}</div> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      {cards.length ? (
        <section className={styles.reviewPanel}>
          <div className={styles.reviewHead}>
            <div><p>REVIEW QUEUE</p><h2>ตรวจ → ทดสอบ → บันทึก</h2><span>{stats.total} เรื่อง · ผ่าน {stats.passed} · ไม่ผ่าน {stats.failed} · บันทึกแล้ว {stats.saved}</span></div>
            <div className={styles.bulkActions}>
              <button type="button" disabled={Boolean(bulkBusy)} onClick={() => void testAll()}>{bulkBusy === "test" ? "กำลังทดสอบ…" : "ทดสอบทั้งหมด"}</button>
              <button type="button" disabled={Boolean(bulkBusy) || !stats.passed} onClick={() => void saveAll("passed")}>{bulkBusy === "save-passed" ? "กำลังบันทึก…" : "บันทึกที่ผ่าน"}</button>
              <button type="button" className={styles.bulkPrimary} disabled={Boolean(bulkBusy) || !stats.unsaved} onClick={() => void saveAll("all")}>{bulkBusy === "save-all" ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}</button>
            </div>
          </div>

          <div className={styles.toolbar}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา ID / code / ชื่อ / provider" />
            <div className={styles.filters}>
              {([ ["all", "ทั้งหมด"], ["unsaved", "ยังไม่บันทึก"], ["passed", "Player ผ่าน"], ["failed", "Player ไม่ผ่าน"], ["saved", "บันทึกแล้ว"] ] as const).map(([key, label]) => <button key={key} type="button" className={filter === key ? styles.filterActive : ""} onClick={() => setFilter(key)}>{label}</button>)}
            </div>
          </div>

          <div className={styles.cardGrid}>
            {filteredCards.map((item) => (
              <article className={styles.card} key={item.id}>
                <div className={styles.thumb}>{item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <span>AVDB</span>}<div className={styles.cardBadges}><span>{item.movieCode || item.id}</span>{item.playerProvider ? <span>{item.playerProvider}</span> : null}</div></div>
                <div className={styles.cardBody}>
                  <h3 title={item.title}>{item.title || `AVDB ${item.id}`}</h3>
                  <p className={styles.meta}>{[item.year, item.quality, item.duration].filter(Boolean).join(" · ") || "รอ metadata"}</p>
                  <p className={styles.description}>{item.description || item.originalTitle || "ไม่มีเรื่องย่อ"}</p>
                  <div className={styles.statusRow}>
                    <span className={styles[`test_${item.testState}`]}>{item.testState === "testing" ? "กำลังทดสอบ" : item.testState === "pass" ? "PLAYER PASS" : item.testState === "fail" ? "PLAYER FAIL" : item.hasPlayer ? "ยังไม่ทดสอบ" : "ไม่มี Player"}</span>
                    <span className={styles[`save_${item.saveState}`]}>{item.saveState === "saving" ? "กำลังบันทึก" : item.saveState === "saved" ? "SAVED" : item.saveState === "error" ? "SAVE ERROR" : "NOT SAVED"}</span>
                  </div>
                  {item.testMessage ? <p className={styles.cardMessage}>{item.testMessage}</p> : null}
                  {item.saveMessage ? <p className={styles.cardMessage}>{item.saveMessage}</p> : null}
                  <div className={styles.cardActions}>
                    <button type="button" disabled={!item.hasPlayer || item.testState === "testing" || Boolean(bulkBusy)} onClick={() => void testOne(item.id, false)}>ทดสอบ</button>
                    {item.playbackUrl ? <button type="button" onClick={() => openPlayer(item.id)}>เปิด Player</button> : null}
                    <button type="button" disabled={item.saveState === "saving" || Boolean(bulkBusy)} onClick={() => void saveOne(item.id)}>{item.saveState === "saved" ? "อัปเดต" : "บันทึก"}</button>
                    <button type="button" className={styles.actionPrimary} disabled={!item.hasPlayer || item.testState === "testing" || item.saveState === "saving" || Boolean(bulkBusy)} onClick={() => void testAndSave(item.id)}>ทดสอบ + {item.saveState === "saved" ? "อัปเดต" : "บันทึก"}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {playerCard ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlayerCard(null); }}>
          <div className={styles.playerModal}>
            <div className={styles.modalHead}><div><b>{playerCard.movieCode || playerCard.id}</b><span>{playerCard.title}</span></div><button type="button" onClick={() => setPlayerCard(null)}>ปิด</button></div>
            <div className={styles.videoFrame}><video key={playerCard.playbackUrl} src={playerCard.playbackUrl} controls autoPlay playsInline /></div>
            <p>Player ทดสอบใช้ Browser Session เดียวกับหน้า Watch และ session สามารถ reuse ได้สูงสุด 30 นาที</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
