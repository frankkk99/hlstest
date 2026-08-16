import Link from "next/link";
import AdminShell from "../admin-shell";
import styles from "../admin.module.css";

const tools = [
  ["/admin/hls-test", "HLS Test", "ตรวจ Manifest, CORS, expiry และ Segment"],
  ["/admin/bulk-player-test", "Bulk Player Test", "ค้นหาและทดสอบหลายเรื่องในฝั่ง MISSAV"],
  ["/admin/player-extractor", "Player Extractor", "ตรวจแหล่ง HLS / MP4"],
  ["/admin/embed-test", "Embed Test", "ทดสอบการครอบ Player"],
] as const;

export default function AdminToolsPage() {
  return (
    <AdminShell
      title="เครื่องมือ MISSAV"
      description="รวมเครื่องมือ Player และ HLS ของ MISSAV เท่านั้น ส่วน AVDB Import ถูกย้ายออกไป AVDB Control Room"
    >
      <section className={styles.panel}>
        <div className={styles.linkGrid}>
          {tools.map(([href, title, description]) => (
            <Link className={styles.actionCard} key={href} href={href}>
              <strong>{title} ↗</strong>
              <span>{description}</span>
            </Link>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
