import Link from "next/link";
import styles from "./avdb-admin.module.css";

const pipeline = [
  ["01", "Source", "กำหนดขอบเขตหน้าต้นทางและกติกาการอ่าน API", "READY TO CONFIGURE"],
  ["02", "Staging", "เก็บข้อมูลดิบก่อนเข้าคลังจริง เพื่อให้ตรวจแก้ได้", "NOT STARTED"],
  ["03", "Duplicate", "รวมซ้ำด้วย code / slug / title โดยไม่ทับข้อมูลดี", "NOT STARTED"],
  ["04", "Player", "ตรวจ link_embed และ Player ก่อนถือว่าพร้อมเผยแพร่", "NOT STARTED"],
  ["05", "Publish", "ส่งเฉพาะรายการที่ผ่านเข้า AVDB catalog public", "LOCKED"],
] as const;

export default function AvdbAdminPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/admin/avdb">AVDB<span>OPS</span></Link>
          <nav className={styles.nav} aria-label="เมนู AVDBAPI">
            <Link href="/admin">Control Rooms</Link>
            <Link href="/admin/avdb">Overview</Link>
            <Link href="/admin/avdb-import-test">Source Lab</Link>
            <Link href="/avdb">Public Preview ↗</Link>
          </nav>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroMain}>
            <p className={styles.eyebrow}>AVDBAPI / PRE-IMPORT CONTROL ROOM</p>
            <h1 className={styles.title}>วางระบบให้พร้อม ก่อนเริ่มดึงข้อมูลจริง</h1>
            <p className={styles.description}>
              AVDBAPI ถูกแยกออกจาก MISSAV ทั้ง UX, admin workflow และเส้นทางข้อมูล ตอนนี้ระบบ public จะไม่ scan ต้นทางอัตโนมัติ และยังไม่มีการ publish AVDB catalog ใด ๆ จนกว่าจะเปิด pipeline อย่างตั้งใจ
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/admin/avdb-import-test">เปิด Source Lab แบบ Manual</Link>
              <Link className={styles.secondary} href="/admin/missav">ไป MISSAV Control Room</Link>
            </div>
          </div>

          <aside className={styles.statusPanel}>
            <div className={styles.statusTop}><h2>Pipeline Status</h2><span className={styles.statusPill}>PRE-IMPORT</span></div>
            <div className={styles.statusList}>
              <div className={styles.statusRow}><span>Auto scan</span><strong>OFF</strong></div>
              <div className={styles.statusRow}><span>Staging DB</span><strong>NOT CONNECTED</strong></div>
              <div className={styles.statusRow}><span>Catalog publish</span><strong>LOCKED</strong></div>
              <div className={styles.statusRow}><span>Public route</span><strong>/avdb</strong></div>
              <div className={styles.statusRow}><span>MISSAV merge</span><strong>DISABLED</strong></div>
            </div>
          </aside>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div><h2>AVDB Pipeline</h2><p>ลำดับงานก่อนเปิดการดึงหลายหน้า</p></div>
          </div>
          <div className={styles.pipeline}>
            {pipeline.map(([number, title, description, state]) => (
              <article className={styles.step} key={number}>
                <span className={styles.stepNumber}>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className={styles.stepState}>{state}</span>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.grid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><h3>กติกาข้อมูล AVDBAPI</h3><span>SOURCE ISOLATION</span></div>
              <ul className={styles.list}>
                <li><span>ฐานข้อมูล</span><strong>แยก namespace / schema จาก MISSAV</strong></li>
                <li><span>รายการซ้ำ</span><strong>merge ภายใน AVDB เท่านั้น</strong></li>
                <li><span>Player ใหม่</span><strong>ผ่าน staging ก่อน publish</strong></li>
                <li><span>ข้อมูลดิบ</span><strong>เก็บ source URL / page / API ref</strong></li>
                <li><span>MISSAV</span><strong>ห้ามเขียนทับ</strong></li>
              </ul>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}><h3>สิ่งที่ทำได้ตอนนี้</h3><span>SAFE MODE</span></div>
              <ul className={styles.list}>
                <li><span>ดูหน้า public mockup</span><strong>/avdb</strong></li>
                <li><span>เปิด Source Lab</span><strong>manual only</strong></li>
                <li><span>ตรวจ API structure</span><strong>ได้</strong></li>
                <li><span>ดึงช่วงหลายหน้าอัตโนมัติ</span><strong>ยังไม่เริ่ม</strong></li>
                <li><span>Publish catalog</span><strong>ยังไม่เปิด</strong></li>
              </ul>
            </article>
          </div>
        </section>

        <div className={styles.lockNotice}>
          การกดเข้าหน้า AVDBAPI public จะไม่ยิง <code>/api/avdb-scan</code> อีกต่อไป ส่วน Source Lab ยังอยู่เพื่อทดสอบแบบ manual เมื่อพร้อมออกแบบ schema/staging แล้วค่อยเปิดขั้นตอน import จริง
        </div>
      </div>
    </main>
  );
}
