import Link from "next/link";
import styles from "./source-select.module.css";

const sections = [
  {
    href: "/avdb",
    badge: "CATALOG / AVDB",
    title: "PLAYER GATEWAY",
    description: "Player กลางของ dev2u.online ใช้ session, verified HLS, Direct Upload18, prewarm และ Browser Session fallback ชุดเดียวกัน หน้า Watch และ iframe จึงไม่ต้องมี resolver แยกกันอีก",
    action: "เปิด AVDB Catalog",
  },
  {
    href: "/admin",
    badge: "CONTROL / ADMIN",
    title: "GATEWAY OPS",
    description: "จัดการ Catalog, HTML Import, Player Health และ Publish จากหลังบ้านเดิม โดยไม่กระทบ MISSAV หรือเครื่องมือเดิมที่ยังอยู่ในระบบ",
    action: "เปิด Control Room",
  },
];

export default function PlayerGatewayHomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>PLAYER<span>GATEWAY</span></Link>
          <Link href="/hls-test" className={styles.toolLink}>HLS Diagnostic</Link>
        </header>

        <section className={styles.hero}>
          <p className={styles.kicker}>DEV2U.ONLINE / PLAYER INFRASTRUCTURE</p>
          <h1 className={styles.title}>Player กลางสำหรับทุกเว็บ</h1>
          <p className={styles.subtitle}>
            ใช้ <strong>/player/[id]</strong> สำหรับหน้า Player และ <strong>/embed/[id]</strong> สำหรับ iframe เว็บภายนอก โดย Playback จริงยังผ่าน session/proxy ของ Gateway และไม่ส่ง HLS ต้นทางให้เว็บลูกค้าโดยตรง
          </p>
        </section>

        <section className={styles.grid} aria-label="Player Gateway">
          {sections.map((section) => (
            <Link key={section.href} href={section.href} className={styles.card}>
              <span className={styles.cardGlow} />
              <div className={styles.cardTop}>
                <span className={styles.badge}>{section.badge}</span>
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
              <div className={styles.cardBottom}>
                <span>{section.action}</span>
                <span className={styles.arrow}>→</span>
              </div>
            </Link>
          ))}
        </section>

        <p className={styles.note}>
          Gateway API: POST /api/player/session · body: catalogId + forceFresh. AVDB Watch, /player และ /embed ใช้ Player Core กลางตัวเดียวกัน
        </p>
      </div>
    </main>
  );
}
