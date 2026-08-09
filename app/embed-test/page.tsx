"use client";

import { useMemo, useState } from "react";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

export default function EmbedTestPage() {
  const [url, setUrl] = useState("");
  const [origin, setOrigin] = useState("https://upload18.org");
  const [referer, setReferer] = useState("https://upload18.org/");
  const [userAgent, setUserAgent] = useState(DEFAULT_UA);
  const [active, setActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const embedPath = useMemo(() => {
    if (!url) return "";
    const params = new URLSearchParams({ url });
    if (origin) params.set("origin", origin);
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    return `/embed?${params.toString()}`;
  }, [url, origin, referer, userAgent]);

  const embedCode = embedPath
    ? `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}${embedPath}" width="100%" height="600" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
    : "";

  return (
    <main style={{ minHeight: "100vh", background: "#071019", color: "#eef5fb", padding: "28px 16px 60px" }}>
      <div style={{ width: "min(1180px, 100%)", margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ color: "#7fb5ff", fontSize: 11, fontWeight: 800, letterSpacing: ".16em" }}>EMBED TEST</div>
          <h1 style={{ margin: "6px 0 8px", fontSize: "clamp(28px,4vw,44px)" }}>ทดสอบครอบ Player ด้วย iframe</h1>
          <p style={{ color: "#8fa1b2", margin: 0 }}>วาง Manifest URL เดิม แล้วทดสอบว่า Player ที่ครอบผ่าน /embed เล่นได้จริงหรือไม่</p>
        </div>

        <section style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 16, background: "rgba(13,24,36,.9)", display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 7 }}>
            <span style={{ fontSize: 12, color: "#a8b9c8", fontWeight: 700 }}>Manifest / Media URL</span>
            <textarea
              rows={5}
              value={url}
              onChange={(e) => { setUrl(e.target.value.trim()); setActive(false); }}
              placeholder="https://helvid.com/m/..."
              style={{ width: "100%", resize: "vertical", border: "1px solid rgba(255,255,255,.1)", background: "#030a10", color: "#eef5fb", borderRadius: 12, padding: 12, font: "inherit" }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 7 }}>
              <span style={{ fontSize: 12, color: "#a8b9c8", fontWeight: 700 }}>Origin</span>
              <input value={origin} onChange={(e) => { setOrigin(e.target.value); setActive(false); }} style={{ border: "1px solid rgba(255,255,255,.1)", background: "#030a10", color: "#eef5fb", borderRadius: 12, padding: 12 }} />
            </label>
            <label style={{ display: "grid", gap: 7 }}>
              <span style={{ fontSize: 12, color: "#a8b9c8", fontWeight: 700 }}>Referer</span>
              <input value={referer} onChange={(e) => { setReferer(e.target.value); setActive(false); }} style={{ border: "1px solid rgba(255,255,255,.1)", background: "#030a10", color: "#eef5fb", borderRadius: 12, padding: 12 }} />
            </label>
          </div>

          <label style={{ display: "grid", gap: 7 }}>
            <span style={{ fontSize: 12, color: "#a8b9c8", fontWeight: 700 }}>User-Agent</span>
            <input value={userAgent} onChange={(e) => { setUserAgent(e.target.value); setActive(false); }} style={{ border: "1px solid rgba(255,255,255,.1)", background: "#030a10", color: "#eef5fb", borderRadius: 12, padding: 12 }} />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={!url}
              onClick={() => setActive(true)}
              style={{ border: 0, borderRadius: 11, padding: "11px 16px", background: "linear-gradient(180deg,#2d7ef7,#1766dc)", color: "white", fontWeight: 800, opacity: url ? 1 : .45 }}
            >
              ทดสอบ Embed ตอนนี้
            </button>
            {embedPath && (
              <button
                type="button"
                onClick={() => window.open(embedPath, "_blank", "noopener,noreferrer")}
                style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 11, padding: "11px 16px", background: "rgba(255,255,255,.06)", color: "white", fontWeight: 800 }}
              >
                เปิด Player เต็มหน้า
              </button>
            )}
          </div>
        </section>

        {active && embedPath && (
          <>
            <section style={{ marginTop: 16, border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 16, background: "rgba(13,24,36,.9)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ color: "#7fb5ff", fontSize: 11, fontWeight: 800, letterSpacing: ".16em" }}>LIVE IFRAME</div>
                  <h2 style={{ margin: "4px 0 0" }}>ผลทดสอบครอบ Player</h2>
                </div>
                <span style={{ color: "#5ee0a0", border: "1px solid #5ee0a0", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 900 }}>EMBED</span>
              </div>
              <iframe
                key={embedPath}
                src={embedPath}
                title="HLS embed test"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                style={{ display: "block", width: "100%", aspectRatio: "16 / 9", minHeight: 280, border: 0, borderRadius: 14, background: "#000" }}
              />
            </section>

            <section style={{ marginTop: 16, border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 16, background: "rgba(13,24,36,.9)" }}>
              <h2 style={{ margin: "0 0 10px" }}>โค้ด iframe สำหรับทดสอบเว็บอื่น</h2>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#030a10", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,.1)", color: "#b9d5ef" }}>{embedCode}</pre>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(embedCode);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                style={{ border: 0, borderRadius: 11, padding: "10px 14px", background: "linear-gradient(180deg,#2d7ef7,#1766dc)", color: "white", fontWeight: 800 }}
              >
                {copied ? "คัดลอกแล้ว ✓" : "คัดลอก iframe"}
              </button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
