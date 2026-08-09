"use client";

import { useState } from "react";

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
};

export default function AvdbImportTestPage() {
  const [pageUrl, setPageUrl] = useState("https://avdbapi.com/index-12263/");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

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

  const items = result?.items || [];

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AVDB IMPORT TEST</p>
          <h1>ทดสอบดึงข้อมูล 1 หน้า</h1>
          <p className="subtitle">AVDB index → ปุ่ม API → JSON → metadata + Upload18 link_embed</p>
        </div>
        <div className="status-chip">Import only</div>
      </section>

      <section className="panel" style={{ padding: 18 }}>
        <label className="field">
          <span>AVDB page URL</span>
          <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} spellCheck={false} />
        </label>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="primary" type="button" disabled={!pageUrl || loading} onClick={scanPage}>
            {loading ? "กำลังอ่านหน้าและ API…" : "สแกน 1 หน้า"}
          </button>
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

      {items.length > 0 && (
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

      <p className="hint" style={{ marginTop: 14 }}>หน้านี้ทำเฉพาะขั้นดึงข้อมูลและ link_embed ยังไม่เปิด Upload18 Player และยังไม่ตรวจ HLS</p>
    </main>
  );
}
