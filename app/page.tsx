import Link from "next/link";
import styles from "./source-select.module.css";

const sources = [
  {
    href: "/avdb",
    badge: "AVDBAPI",
    title: "AVDBAPI",
    description: "หน้าเว็บหนังจาก AVDBAPI โดยตรง แสดงข้อมูลชื่อเรื่อง รหัส ปี คุณภาพ ระยะเวลา ภาพปก และ Player ที่พบจากแหล่งนี้",
    action: "เปิดหน้า AVDBAPI",
  },
  {
    href: "/hub",
    badge: "MISSAV",
    title: "MISSAV",
    description: "หน้าเว็บหนังจาก catalog ฝั่ง MISSAV พร้อมรายการที่ผ่านการตรวจ Player แล้ว ระบบค้นหา Hero และหน้ารับชมเดิม",
    action: "เปิดหน้า MISSAV",
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
          <p className={styles.kicker}>CHOOSE CONTENT SOURCE</p>
          <h1 className={styles.title}>เลือกแหล่งข้อมูลก่อนเข้าหน้าเว็บ</h1>
          <p className={styles.subtitle}>
            แต่ละแหล่งแยกข้อมูลออกจากกันชัดเจน เมื่อเลือกแล้วจะเข้าสู่หน้าแรกแบบเว็บหนังของแหล่งนั้นโดยตรง
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
          สามารถกลับมาหน้านี้ได้ตลอดจากปุ่ม “เปลี่ยนแหล่ง” โดยไม่ต้องรวมข้อมูล AVDBAPI และ MISSAV เข้าด้วยกัน
        </p>
      </div>
    </main>
  );
}
