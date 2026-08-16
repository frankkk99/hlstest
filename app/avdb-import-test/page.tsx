"use client";

import { useRef, useState } from "react";

type Item = {
  row: number;
  apiUrl: string;
  apiStatus: number;
  apiElapsedMs: number;
  id: number | null;
  name: string;
  slug: string;
  movieCode: string;
  typeName: string;
  year: string;
  quality: string;
  duration: string;
  posterUrl: string;
  thumbUrl: string;
  playerUrl: string | null;
};

type ScanResult = {
  ok: boolean;
  error?: string;
  pageUrl?: string;
  finalPageUrl?: string;
  pageStatus?: number;
  apiLinksFound?: number;
  itemsFound?: number;
  elapsedMs?: number;
  items?: Item[];
  apiErrors?: Array<{ error?: string }>;
};

type RangePage = {
  pageNumber: number;
  pageUrl: string;
  ok: boolean;
  pageStatus?: number;
  itemsFound: number;
  apiLinksFound: number;
  elapsedMs: number;
  error?: string;
};

type RangeItem = Item & { pageNumber: number };

function parsePageNumber(raw: string) {
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/^\/index-(\d+)\/?$/i);
    return match ? Number(match[1]) : 1;
  } catch {
    return null;
  }
}

function buildPageUrl(raw: string, pageNumber: number) {
  const url = new URL(raw);
  url.pathname = pageNumber <= 1 ? "/" : `/index-${pageNumber}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export default function AvdbImportTestPage() {
  const [pageUrl, setPageUrl] = useState("https://avdbapi.com/");
  const [endPageUrl, setEndPageUrl] = useState("https://avdbapi.com/index-10262/");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [rangeRunning, setRangeRunning] = useState(false);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [rangeCursor, setRangeCursor] = useState<number | null>(null);
  const [rangePages, setRangePages] = useState<RangePage[]>([]);
  const [rangeItems, setRangeItems] = useState<RangeItem[]>([]);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const stopRangeRef = useRef(false);
  const rangeCursorRef = useRef<number | null>(null);
  const abortRangeRef = useRef<AbortController | null>(null);

  async function scanPage() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/avdb-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl }),
      });
      setResult((await response.json()) as ScanResult);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Scan failed" });
    } finally {
      setLoading(false);
    }
  }

  async function scanRange(resume = false) {
    if (rangeRunning) return;

    const start = resume ? rangeCursorRef.current : parsePageNumber(pageUrl);
    const end = rangeEnd ?? parsePageNumber(endPageUrl);

    if (start === null || end === null) {
      setRangeError("กรุณาใส่ URL AVDB ให้ถูกต้อง เช่น https://avdbapi.com/ หรือ /index-10262/");
      return;
    }

    if (start < 1 || end < 1 || start > end) {
      setRangeError("เลขหน้าเริ่มต้นต้องไม่มากกว่าหน้าสิ้นสุด");
      return;
    }

    if (!resume) {
      setRangeStart(start);
      setRangeEnd(end);
      setRangeCursor(start);
      rangeCursorRef.current = start;
      setRangePages([]);
      setRangeItems([]);
      setRangeError(null);
    }

    stopRangeRef.current = false;
    setRangeRunning(true);

    try {
      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        if (stopRangeRef.current) break;

        const currentUrl = buildPageUrl(pageUrl, pageNumber);
        const controller = new AbortController();
        abortRangeRef.current = controller;
        rangeCursorRef.current = pageNumber;
        setRangeCursor(pageNumber);

        let pageResult: ScanResult;
        try {
          const response = await fetch("/api/avdb-scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageUrl: currentUrl }),
            signal: controller.signal,
          });
          pageResult = (await response.json()) as ScanResult;
        } catch (error) {
          if (stopRangeRef.current) break;
          pageResult = {
            ok: false,
            error: error instanceof Error ? error.message : "Scan failed",
          };
        }

        const pageState: RangePage = {
          pageNumber,
          pageUrl: currentUrl,
          ok: Boolean(pageResult.ok),
          pageStatus: pageResult.pageStatus,
          itemsFound: pageResult.itemsFound ?? pageResult.items?.length ?? 0,
          apiLinksFound: pageResult.apiLinksFound ?? 0,
          elapsedMs: pageResult.elapsedMs ?? 0,
          error: pageResult.error,
        };

        setRangePages((previous) => [...previous, pageState]);
        if (pageResult.items?.length) {
          const currentItems = pageResult.items.map((item) => ({ ...item, pageNumber }));
          setRangeItems((previous) => [...previous, ...currentItems].slice(-200));
        }
        if (!pageResult.ok || !pageResult.items?.length) {
          setRangeError(pageResult.error || `หน้า ${pageNumber} ไม่พบข้อมูล`);
        } else {
          setRangeError(null);
        }

        rangeCursorRef.current = pageNumber + 1;
        setRangeCursor(pageNumber + 1);
      }
    } finally {
      abortRangeRef.current = null;
      setRangeRunning(false);
    }
  }

  function stopRange() {
    stopRangeRef.current = true;
    abortRangeRef.current?.abort();
    setRangeRunning(false);
  }

  function resetRange() {
    stopRange();
    setRangeStart(null);
    setRangeEnd(null);
    setRangeCursor(null);
    rangeCursorRef.current = null;
    setRangePages([]);
    setRangeItems([]);
    setRangeError(null);
  }

  const items = result?.items || [];

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AVDB IMPORT TEST</p>
          <h1>ดึงข้อมูล AVDB หลายหน้า</h1>
          <p className="subtitle">AVDB index → ปุ่ม API → JSON → metadata + Upload18 link_embed</p>
        </div>
        <div className="status-chip">Import only</div>
      </section>

      <section className="panel" style={{ padding: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <label className="field">
            <span>หน้าเริ่มต้น / หน้าเดียว</span>
            <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} spellCheck={false} />
          </label>
          <label className="field">
            <span>หน้าสิ้นสุด</span>
            <input value={endPageUrl} onChange={(e) => setEndPageUrl(e.target.value)} spellCheck={false} />
          </label>
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>
          ตัวอย่าง: เริ่มจาก <code>https://avdbapi.com/</code> ถึง <code>https://avdbapi.com/index-10262/</code> ระบบจะดึงทีละหน้าและจำหน้าถัดไปไว้เมื่อกดหยุด
        </p>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" disabled={!pageUrl || loading || rangeRunning} onClick={scanPage}>
            {loading ? "กำลังอ่านหน้าและ API…" : "สแกนหน้าเดียว"}
          </button>
          <button className="primary" type="button" disabled={!pageUrl || !endPageUrl || loading || rangeRunning} onClick={() => void scanRange(false)}>
            {rangeRunning ? `กำลังดึงหน้า ${rangeCursor ?? "…"}` : "เริ่มดึงช่วงหน้า"}
          </button>
          {rangeRunning && <button type="button" onClick={stopRange}>หยุดชั่วคราว</button>}
          {!rangeRunning && rangeCursor !== null && rangeEnd !== null && rangeCursor <= rangeEnd && rangePages.length > 0 && (
            <button type="button" onClick={() => void scanRange(true)}>ทำต่อจากหน้า {rangeCursor}</button>
          )}
          {rangePages.length > 0 && <button type="button" onClick={resetRange}>ล้างผลช่วงหน้า</button>}
        </div>
      </section>

      {result?.error && <div className="alert badbox">{result.error}</div>}

      {result?.ok && (
        <section className="summary-grid">
          <article className="metric"><span>Page HTTP</span><strong>{result.pageStatus ?? "-"}</strong><small>{result.finalPageUrl}</small></article>
          <article className="metric"><span>API buttons</span><strong>{result.apiLinksFound ?? 0}</strong><small>พบในหน้า</small></article>
          <article className="metric"><span>Items</span><strong>{result.itemsFound ?? 0}</strong><small>อ่าน JSON สำเร็จ</small></article>
          <article className="metric"><span>Elapsed</span><strong>{result.elapsedMs ?? 0}</strong><small>ms</small></article>
        </section>
      )}

      {(rangePages.length > 0 || rangeRunning || rangeError) && (
        <section className="panel diagnostics">
          <div className="panel-title">
            <div>
              <p className="eyebrow">RANGE SCAN</p>
              <h2>ความคืบหน้าการดึงหลายหน้า</h2>
            </div>
            <span className="status-chip">{rangeRunning ? "RUNNING" : "PAUSED"}</span>
          </div>
          {rangeStart !== null && rangeEnd !== null && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                <span>หน้า {Math.min(rangeCursor ?? rangeStart, rangeEnd)} / {rangeEnd}</span>
                <span>{rangePages.length.toLocaleString()} หน้าที่อ่านแล้ว · {rangePages.reduce((sum, page) => sum + page.itemsFound, 0).toLocaleString()} รายการ</span>
              </div>
              <div style={{ height: 9, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.1)" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (rangePages.length / Math.max(1, rangeEnd - rangeStart + 1)) * 100)}%`, background: "linear-gradient(90deg,#20d3a5,#45a7ff)", transition: "width .2s ease" }} />
              </div>
            </>
          )}
          {rangeError && <div className="alert badbox" style={{ marginTop: 12 }}>{rangeError}</div>}
          {rangePages.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr><th style={{ textAlign: "left", padding: 8 }}>หน้า</th><th style={{ textAlign: "left", padding: 8 }}>HTTP</th><th style={{ textAlign: "left", padding: 8 }}>API</th><th style={{ textAlign: "left", padding: 8 }}>รายการ</th><th style={{ textAlign: "left", padding: 8 }}>เวลา</th><th style={{ textAlign: "left", padding: 8 }}>สถานะ</th></tr></thead>
                <tbody>{rangePages.slice(-30).map((page) => (
                  <tr key={`${page.pageNumber}-${page.pageUrl}`}>
                    <td style={{ padding: 8 }}>{page.pageNumber}</td>
                    <td style={{ padding: 8 }}>{page.pageStatus ?? "-"}</td>
                    <td style={{ padding: 8 }}>{page.apiLinksFound}</td>
                    <td style={{ padding: 8 }}>{page.itemsFound}</td>
                    <td style={{ padding: 8 }}>{page.elapsedMs} ms</td>
                    <td style={{ padding: 8, color: page.ok && page.itemsFound > 0 ? "#42e0aa" : "#ff8f8f" }}>{page.ok && page.itemsFound > 0 ? "สำเร็จ" : page.error || "ไม่พบข้อมูล"}</td>
                  </tr>
                ))}</tbody>
              </table>
              {rangePages.length > 30 && <p className="hint" style={{ marginTop: 8 }}>แสดงเฉพาะ 30 หน้าล่าสุด เพื่อไม่ให้หน้าเว็บหนัก ข้อมูลการนับยังเก็บครบตามที่ดึงได้</p>}
            </div>
          )}
        </section>
      )}

      {items.length > 0 && !rangePages.length && (
        <section className="panel diagnostics">
          <div className="panel-title"><div><p className="eyebrow">RESULT</p><h2>ข้อมูลในหน้านี้</h2></div></div>
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((item) => (
              <article key={`${item.apiUrl}-${item.row}`} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 13, background: "rgba(3,11,19,.42)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <b style={{ color: "#69c7ff" }}>{item.movieCode || item.slug || `#${item.id}`}</b>
                      <span className="binding on">{item.typeName || "unknown"}</span>
                      {item.year && <span className="binding">{item.year}</span>}
                      {item.quality && <span className="binding">{item.quality}</span>}
                    </div>
                    <div style={{ marginTop: 7, lineHeight: 1.5 }}>{item.name}</div>
                    <div className="hint">API HTTP {item.apiStatus} · {item.apiElapsedMs} ms</div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <span style={{ color: "#8fa1b2", fontSize: 11 }}>Upload18 link_embed</span>
                  <code className="urlblock">{item.playerUrl || "ไม่พบ link_embed"}</code>
                </div>
                <details>
                  <summary>API URL</summary>
                  <code className="urlblock">{item.apiUrl}</code>
                </details>
              </article>
            ))}
          </div>
        </section>
      )}

      {rangeItems.length > 0 && (
        <section className="panel diagnostics">
          <div className="panel-title"><div><p className="eyebrow">LATEST ITEMS</p><h2>รายการล่าสุดที่ดึงได้</h2></div></div>
          <p className="hint">เก็บไว้แสดงเฉพาะ 200 รายการล่าสุด ส่วนการสแกนยังเดินหน้าต่อได้โดยไม่ทำให้เบราว์เซอร์ค้าง</p>
          <div style={{ display: "grid", gap: 10 }}>
            {rangeItems.map((item) => (
              <article key={`${item.pageNumber}-${item.apiUrl}-${item.row}`} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 13, background: "rgba(3,11,19,.42)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ color: "#69c7ff" }}>{item.movieCode || item.slug || `#${item.id}`}</b>
                  <span className="binding on">หน้า {item.pageNumber}</span>
                  {item.typeName && <span className="binding">{item.typeName}</span>}
                </div>
                <div style={{ marginTop: 7, lineHeight: 1.5 }}>{item.name}</div>
                <code className="urlblock">{item.playerUrl || "ไม่พบ link_embed"}</code>
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="hint" style={{ marginTop: 14 }}>หน้านี้ทำเฉพาะขั้นดึงข้อมูลและ link_embed ยังไม่เปิด Upload18 Player และยังไม่ตรวจ HLS</p>
    </main>
  );
}
