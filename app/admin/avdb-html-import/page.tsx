import Link from "next/link";
import AvdbHtmlImportConsole from "./import-console";
import styles from "./page.module.css";

export default function AvdbHtmlImportPage() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <p>AVDB ADMIN TOOL</p>
          <h1>HTML Import Console</h1>
          <span>นำเข้าจากหน้าที่เปิดได้ → Preview → ตรวจ Player → บันทึก</span>
        </div>
        <nav aria-label="เมนู AVDB HTML Import">
          <Link href="/admin/avdb">← AVDB Control Room</Link>
          <Link href="/admin/avdb-import-test">Source Lab</Link>
          <Link href="/avdb">Public ↗</Link>
        </nav>
      </header>
      <AvdbHtmlImportConsole />
    </main>
  );
}
