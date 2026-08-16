export default function Loading() {
  return (
    <main style={{ minHeight: "100vh", padding: "20px 16px", background: "#080c11" }} aria-label="กำลังโหลด HTML Import Console">
      <div style={{ width: "min(1420px,100%)", margin: "0 auto", display: "grid", gap: 14 }}>
        <div style={{ height: 88, borderRadius: 16, background: "rgba(255,255,255,.055)" }} />
        <div style={{ height: 330, borderRadius: 18, background: "rgba(255,255,255,.045)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          {Array.from({ length: 6 }, (_, index) => <div key={index} style={{ aspectRatio: "16 / 11", borderRadius: 13, background: "rgba(255,255,255,.04)" }} />)}
        </div>
      </div>
    </main>
  );
}
