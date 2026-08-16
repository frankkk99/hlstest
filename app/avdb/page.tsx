import Link from "next/link";
import styles from "./avdb.module.css";

const slots = Array.from({ length: 8 }, (_, index) => index + 1);

export default function AvdbStorefrontPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <nav className={styles.nav} aria-label="เมนู AVDBAPI">
          <Link href="/avdb" className={styles.active}>INDEX</Link>
          <Link href="/hub">MISSAV CINEMA</Link>
          <Link href="/">CHANGE SOURCE</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>AVDBAPI / SOURCE-ISOLATED CATALOG</p>
          <h1>AVDB<br /><span>INDEX</span></h1>
          <p className={styles.description}>
            หน้านี้ออกแบบเป็นฐานข้อมูลภาพยนตร์แบบ index-first ต่างจาก MISSAV ที่เน้นประสบการณ์แบบ Cinema ตอนนี้ยังไม่เปิดดึงข้อมูล AVDBAPI อัตโนมัติ
          </p>
          <div className={styles.heroMeta}>
            <span>CATALOG: PRE-IMPORT</span>
            <span>AUTO SCAN: OFF</span>
            <span>MISSAV MERGE: DISABLED</span>
          </div>
        </div>

        <aside className={styles.heroPanel}>
          <div className={styles.panelCode}>AVDB / 00</div>
          <div className={styles.panelRows}>
            <div><span>Source</span><strong>avdbapi.com</strong></div>
            <div><span>Staging</span><strong>Not started</strong></div>
            <div><span>Published items</span><strong>0</strong></div>
            <div><span>Pipeline</span><strong>Paused</strong></div>
          </div>
        </aside>
      </section>

      <section className={styles.workspace}>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.toolbarEyebrow}>PUBLIC CATALOG</p>
            <h2>พื้นที่แสดงผล AVDBAPI</h2>
            <p>เมื่อเริ่ม import แล้ว รายการที่ผ่าน staging และ Player verification เท่านั้นที่จะเข้ามาแสดงตรงนี้</p>
          </div>
          <div className={styles.searchMock} aria-disabled="true">SEARCH DISABLED UNTIL CATALOG READY</div>
        </div>

        <div className={styles.grid} aria-label="AVDB catalog slots">
          {slots.map((slot) => (
            <article className={styles.card} key={slot}>
              <div className={styles.cardVisual}>
                <span className={styles.slot}>SLOT {String(slot).padStart(2, "0")}</span>
                <span className={styles.crosshair}>+</span>
              </div>
              <div className={styles.cardBody}>
                <strong>รอข้อมูลจาก AVDB Staging</strong>
                <div className={styles.cardMeta}><span>CODE —</span><span>YEAR —</span><span>PLAYER —</span></div>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.notice}>
          <strong>PRE-IMPORT MODE</strong>
          <span>การเปิดหน้านี้ไม่เรียก <code>/api/avdb-scan</code> และไม่เริ่มดึงข้อมูลต้นทาง</span>
        </div>
      </section>
    </main>
  );
}
