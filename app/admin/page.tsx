"use client";

import Link from "next/link";

const tools = [
  ["/admin/hls-test", "HLS Test", "ตรวจ Manifest และ Segment"],
  ["/admin/avdb-import-test", "AVDB Import", "ดึงข้อมูลจากหน้า AVDB"],
  ["/admin/bulk-player-test", "Bulk Player Test", "ค้นหาและทดสอบหลายเรื่อง"],
  ["/admin/player-extractor", "Player Extractor", "ตรวจแหล่ง HLS / MP4"],
  ["/admin/embed-test", "Embed Test", "ทดสอบการครอบ Player"],
] as const;

export default function AdminPage() {
  return <main style={{ minHeight: "100vh", padding: "48px 20px 90px", background: "#070b12", color: "#f5f7fb" }}>
    <div style={{ width: "min(1120px, 100%)", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginBottom: 30 }}>
        <div><p style={{ margin: 0, color: "#9ec4ff", fontSize: 11, fontWeight: 900, letterSpacing: ".16em" }}>HLSHUB CONTROL ROOM</p><h1 style={{ margin: "10px 0 0", fontSize: "clamp(30px, 5vw, 52px)", letterSpacing: "-.06em" }}>ระบบหลังบ้าน</h1><p style={{ color: "#93a2b4" }}>เลือกเครื่องมือที่ต้องการใช้งาน โดยระบบดึงข้อมูลเดิมยังทำงานเหมือนเดิม</p></div>
        <div style={{ display: "flex", gap: 8 }}><Link href="/" style={{ color: "#dce8f7", textDecoration: "none" }}>หน้าเว็บ</Link><button type="button" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); window.location.href = "/"; }} style={{ border: "1px solid rgba(255,255,255,.15)", borderRadius: 9, padding: "8px 11px", color: "#dce8f7", background: "rgba(255,255,255,.05)", cursor: "pointer" }}>ออกจากระบบ</button></div>
      </header>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
        {tools.map(([href, title, description]) => <Link key={href} href={href} style={{ minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: 20, color: "#f5f7fb", background: "#111b28", textDecoration: "none" }}><span style={{ color: "#9ec4ff", fontSize: 12, fontWeight: 900 }}>เปิดเครื่องมือ ↗</span><span><strong style={{ display: "block", fontSize: 18 }}>{title}</strong><small style={{ display: "block", marginTop: 8, color: "#93a2b4", lineHeight: 1.5 }}>{description}</small></span></Link>)}
      </section>
    </div>
  </main>;
}
