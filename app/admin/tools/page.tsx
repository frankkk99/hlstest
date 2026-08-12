import Link from "next/link";
import AdminShell from "../admin-shell";
import styles from "../admin.module.css";

const tools = [["/admin/hls-test", "HLS Test", "ตรวจ Manifest, CORS, expiry และ Segment"], ["/admin/avdb-import-test", "AVDB Import", "ดึงข้อมูลจากหน้า AVDB ตาม flow เดิม"], ["/admin/bulk-player-test", "Bulk Player Test", "ค้นหาและทดสอบหลายเรื่อง"], ["/admin/player-extractor", "Player Extractor", "ตรวจแหล่ง HLS / MP4"], ["/admin/embed-test", "Embed Test", "ทดสอบการครอบ Player"]] as const;
export default function AdminToolsPage() { return <AdminShell title="เครื่องมือเดิม" description="รวมลิงก์ไปยังเครื่องมือที่มีอยู่เดิม แยกเป็นหน้าเฉพาะให้ค้นหาได้ง่าย โดยไม่แก้ flow การทำงานของแต่ละเครื่องมือ"><section className={styles.panel}><div className={styles.linkGrid}>{tools.map(([href, title, description]) => <Link className={styles.actionCard} key={href} href={href}><strong>{title} ↗</strong><span>{description}</span></Link>)}</div></section></AdminShell>; }
