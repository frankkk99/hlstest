"use client";

import Link from "next/link";
import styles from "./admin-gateway.module.css";

export default function AdminSourceGateway() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/">HLS<span>HUB</span> / ADMIN</Link>
          <button
            className={styles.logout}
            type="button"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              window.location.href = "/";
            }}
          >
            ออกจากระบบ
          </button>
        </header>

        <section className={styles.hero}>
          <p className={styles.kicker}>SELECT CONTROL ROOM</p>
          <h1 className={styles.title}>สองแหล่ง สองระบบหลังบ้าน</h1>
          <p className={styles.subtitle}>
            MISSAV และ AVDBAPI แยก workflow, สถานะข้อมูล และเครื่องมือออกจากกัน เพื่อป้องกันการ merge หรือดึงข้อมูลข้ามแหล่งโดยไม่ตั้งใจ
          </p>
        </section>

        <section className={styles.grid} aria-label="เลือก Control Room">
          <Link className={`${styles.card} ${styles.missav}`} href="/admin/missav">
            <div className={styles.cardTop}>
              <span className={styles.badge}>LIVE CATALOG</span>
              <h2>MISSAV</h2>
              <p>ระบบ production ที่มี catalog และ Player health อยู่แล้ว ใช้สำหรับดูแลรายการที่เผยแพร่บน /hub เท่านั้น</p>
              <div className={styles.stats}>
                <div className={styles.stat}><span>STATE</span><strong>LIVE</strong></div>
                <div className={styles.stat}><span>PUBLIC</span><strong>/hub</strong></div>
                <div className={styles.stat}><span>DATA</span><strong>DB</strong></div>
              </div>
            </div>
            <div className={styles.cardBottom}><span>เปิด MISSAV Control Room</span><span className={styles.arrow}>→</span></div>
          </Link>

          <Link className={`${styles.card} ${styles.avdb}`} href="/admin/avdb">
            <div className={styles.cardTop}>
              <span className={styles.badge}>PRE-IMPORT</span>
              <h2>AVDBAPI</h2>
              <p>พื้นที่เตรียม pipeline ใหม่ แยกจาก MISSAV โดยสมบูรณ์ ตอนนี้ยังไม่เปิดการดึงข้อมูลอัตโนมัติและยังไม่ publish catalog</p>
              <div className={styles.stats}>
                <div className={styles.stat}><span>STATE</span><strong>PAUSED</strong></div>
                <div className={styles.stat}><span>PUBLIC</span><strong>/avdb</strong></div>
                <div className={styles.stat}><span>IMPORT</span><strong>OFF</strong></div>
              </div>
            </div>
            <div className={styles.cardBottom}><span>เปิด AVDBAPI Control Room</span><span className={styles.arrow}>→</span></div>
          </Link>
        </section>

        <p className={styles.note}>การเข้าหน้า AVDBAPI public หรือ admin จะไม่เรียก /api/avdb-scan อัตโนมัติ การดึงข้อมูลต้องเริ่มจาก action แบบ manual เท่านั้น</p>
      </div>
    </main>
  );
}
