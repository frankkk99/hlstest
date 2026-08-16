"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./avdb-html-importer.module.css";

type ImportedItem = {
  id: string;
  movieCode: string;
  title: string;
  quality: string;
  duration: string;
  thumbUrl: string;
  playerProvider: string | null;
};

type ImportResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  requested: number;
  fetched: number;
  failed: number;
  inserted: number;
  updated: number;
  duplicates: number;
  errors?: Array<{ id: string; error: string }>;
  items?: ImportedItem[];
};

type Progress = {
  sourcesTotal: number;
  sourcesDone: number;
  idsFound: number;
  processed: number;
  inserted: number;
  updated: number;
  duplicates: number;
  failed: number;
};

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

function emptyProgress(): Progress {
  return { sourcesTotal: 0, sourcesDone: 0, idsFound: 0, processed: 0, inserted: 0, updated: 0, duplicates: 0, failed: 0 };
}

export default function AvdbHtmlImporter({ onImported }: { onImported?: () => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [paste, setPaste] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<Progress>(emptyProgress());
  const [results, setResults] = useState<ImportedItem[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);

  const pasteCount = useMemo(() => extractAvdbIds(paste).length, [paste]);
  const progressPercent = progress.idsFound > 0 ? Math.min(100, Math.round((progress.processed / progress.idsFound) * 100)) : 0;

  async function sendBatch(ids: string[], sourceName: string, sourcePage: number | null) {
    const response = await fetch("/api/admin/avdb/import-html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, sourceName, sourcePage }),
    });
    const payload = (await response.json()) as ImportResponse;
    if (!response.ok || !payload.ok) throw new Error(payload.error || "นำเข้าชุดนี้ไม่สำเร็จ");
    return payload;
  }

  async function importSources(sources: Array<{ name: string; text: string }>) {
    setBusy(true);
    setError("");
    setNotice("");
    setResults([]);
    setFailedIds([]);
    const seen = new Set<string>();
    const prepared = sources.map((source) => {
      const ids = extractAvdbIds(source.text).filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return { ...source, ids, page: detectSourcePage(source.name, source.text) };
    });
    const idsFound = prepared.reduce((sum, source) => sum + source.ids.length, 0);
    if (!idsFound) {
      setBusy(false);
      setError("ไม่พบ AVDB ID/API detail link ในข้อมูลที่ให้มา");
      return;
    }

    let current: Progress = { ...emptyProgress(), sourcesTotal: prepared.length, idsFound };
    setProgress(current);
    const collected: ImportedItem[] = [];
    const failed: string[] = [];

    try {
      for (const source of prepared) {
        for (const batch of chunks(source.ids, BATCH_SIZE)) {
          const payload = await sendBatch(batch, source.name, source.page);
          current = {
            ...current,
            processed: current.processed + payload.requested,
            inserted: current.inserted + payload.inserted,
            updated: current.updated + payload.updated,
            duplicates: current.duplicates + payload.duplicates,
            failed: current.failed + payload.failed,
          };
          setProgress(current);
          if (payload.items?.length) {
            collected.unshift(...payload.items);
            setResults([...collected].slice(0, 18));
          }
          if (payload.errors?.length) {
            failed.push(...payload.errors.map((entry) => entry.id));
            setFailedIds([...new Set(failed)]);
          }
        }
        current = { ...current, sourcesDone: current.sourcesDone + 1 };
        setProgress(current);
      }
      setNotice(`เสร็จแล้ว · พบ ${current.idsFound} ID · ใหม่ ${current.inserted} · อัปเดต ${current.updated} · ซ้ำ ${current.duplicates} · API ไม่ผ่าน ${current.failed}`);
      await onImported?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "นำเข้า AVDB จากไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function importFiles() {
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      setError(`เลือกได้สูงสุด ${MAX_FILES} ไฟล์ต่อรอบ`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`${oversized.name} ใหญ่เกิน 4 MB กรุณาแยกไฟล์`);
      return;
    }
    try {
      const sources: Array<{ name: string; text: string }> = [];
      for (const file of files) sources.push({ name: file.name, text: await file.text() });
      await importSources(sources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านไฟล์ไม่สำเร็จ");
    }
  }

  async function importPaste() {
    if (!paste.trim()) return;
    await importSources([{ name: "pasted-avdb-source", text: paste }]);
  }

  return (
    <section className={styles.wrap} aria-label="นำเข้า AVDB จากไฟล์หน้าเว็บ">
      <div className={styles.head}>
        <div>
          <p>HTML / SAVED PAGE IMPORT</p>
          <h2>วางไฟล์หน้าที่เปิดได้แทนหน้าที่ถูกบล็อก</h2>
          <span>อ่าน ID จาก source ใน browser แล้วเรียก API detail รายเรื่องเป็น batch เล็ก ๆ จาก server ไม่ต้องเปิด /index-x/ ซ้ำ</span>
        </div>
        <span className={styles.badge}>DEDUPED</span>
      </div>

      <div className={styles.grid}>
        <div className={styles.uploadBox}>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".html,.htm,.md,.txt,text/html,text/plain,text/markdown"
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
            hidden
          />
          <button className={styles.pick} type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            เลือกไฟล์หน้าเว็บ
          </button>
          <strong>{files.length ? `${files.length} ไฟล์พร้อมนำเข้า` : "รองรับหลายไฟล์พร้อมกัน"}</strong>
          <small>.html / .htm / .md / .txt · สูงสุด 50 ไฟล์ · 4 MB/ไฟล์</small>
          {files.length ? (
            <div className={styles.fileList}>
              {files.slice(0, 6).map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
              {files.length > 6 ? <span>+{files.length - 6} ไฟล์</span> : null}
            </div>
          ) : null}
          <button className={styles.primary} type="button" disabled={busy || !files.length} onClick={() => void importFiles()}>
            {busy ? "กำลังนำเข้า…" : "นำเข้าไฟล์ที่เลือก"}
          </button>
        </div>

        <div className={styles.pasteBox}>
          <label htmlFor="avdb-source-paste">วาง HTML / Markdown source</label>
          <textarea
            id="avdb-source-paste"
            value={paste}
            disabled={busy}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="วาง View Source หรือไฟล์หน้า AVDB ที่บันทึกไว้ตรงนี้…"
          />
          <div className={styles.pasteFooter}>
            <span>ตรวจพบ {pasteCount.toLocaleString()} AVDB ID</span>
            <button type="button" disabled={busy || pasteCount === 0} onClick={() => void importPaste()}>นำเข้าข้อความ</button>
          </div>
        </div>
      </div>

      {progress.idsFound ? (
        <div className={styles.progressBox}>
          <div className={styles.progressTop}>
            <div><b>ไฟล์ {progress.sourcesDone}/{progress.sourcesTotal}</b><span>ประมวลผล {progress.processed}/{progress.idsFound} ID</span></div>
            <strong>{progressPercent}%</strong>
          </div>
          <div className={styles.progress}><span style={{ width: `${progressPercent}%` }} /></div>
          <div className={styles.metrics}>
            <span>ใหม่ <b>{progress.inserted}</b></span>
            <span>อัปเดต <b>{progress.updated}</b></span>
            <span>ซ้ำ <b>{progress.duplicates}</b></span>
            <span>API ไม่ผ่าน <b>{progress.failed}</b></span>
          </div>
        </div>
      ) : null}

      {results.length ? (
        <div className={styles.resultGrid}>
          {results.map((item) => (
            <article key={`${item.id}-${item.movieCode}`}>
              <div className={styles.thumb}>{item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <span>AVDB</span>}</div>
              <div><b>{item.movieCode || item.id}</b><p title={item.title}>{item.title || `AVDB ${item.id}`}</p><small>{[item.quality, item.duration, item.playerProvider].filter(Boolean).join(" · ") || "metadata ready"}</small></div>
            </article>
          ))}
        </div>
      ) : null}

      {failedIds.length ? <p className={styles.warning}>API detail ยังอ่านไม่ได้ {failedIds.length} ID: {failedIds.slice(0, 8).join(", ")}{failedIds.length > 8 ? "…" : ""} — สามารถกดนำเข้าไฟล์เดิมซ้ำเพื่อ Retry ได้</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
