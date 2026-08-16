import Link from "next/link";
import styles from "./source-select.module.css";

const sources = [
  {
    href: "/avdb",
    badge: "AVDBAPI / PRE-IMPORT",
    title: "AVDB INDEX",
    description: "ประสบการณ์แบบฐานข้อมูลและ index เน้นรหัส เมทาดาทา และสถานะ Player ตอนนี้อยู่โหมดเตรียมระบบและยังไม่ดึงข้อมูลอัตโนมัติ",
    action: "เปิด AVDB Index",
  },
  {
    href: "/hub",
    badge: "MISSAV / LIVE",
    title: "MISSAV CINEMA",
    description: "ประสบการณ์แบบเว็บหนัง เน้น Hero, การค้นหา, การ์ดภาพยนตร์ และการรับชมจาก catalog MISSAV ที่ผ่าน Player health แล้ว",
    action: "เปิด MISSAV Cinema",
  },
];

export default function SourceSelectorPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>HLS<span>HUB</span></Link>
          <Link href="/hls-test" className={styles.toolLink}>HLS Diagnostic</Link>
        </header>

        <section className={styles.hero}>
          <p className={styles.kicker}>CHOOSE CONTENT EXPERIENCE</p>
          <h1 className={styles.title}>เลือกแหล่งข้อมูลก่อนเข้าหน้าเว็บ</h1>
          <p className={styles.subtitle}>
            ทั้งสองแหล่งแยกข้อมูล, UX และระบบหลังบ้านออกจากกัน ไม่ใช้ catalog หรือ import pipeline ร่วมกัน
          </p>
        </section>

        <section className={styles.grid} aria-label="เลือกแหล่งข้อมูล">
          {sources.map((source) => (
            <Link key={source.href} href={source.href} className={styles.card}>
              <span className={styles.cardGlow} />
              <div className={styles.cardTop}>
                <span className={styles.badge}>{source.badge}</span>
                <h2>{source.title}</h2>
                <p>{source.description}</p>
              </div>
              <div className={styles.cardBottom}>
                <span>{source.action}</span>
                <span className={styles.arrow}>→</span>
              </div>
            </Link>
          ))}
        </section>

        <p className={styles.note}>
          AVDBAPI ยังอยู่ PRE-IMPORT ส่วน MISSAV เป็น LIVE catalog การเข้าหน้า AVDB ไม่เริ่ม scan ต้นทางอัตโนมัติ
        </p>
      </div>
    </main>
  );
}
