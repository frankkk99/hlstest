"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const nav = [
  ["/admin/missav", "ภาพรวม MISSAV"],
  ["/admin/catalog", "จัดการรายการ"],
  ["/admin/test-all", "ทดสอบทุกเรื่อง"],
  ["/admin/health", "Player Health"],
  ["/admin/tools", "เครื่องมือ MISSAV"],
  ["/admin/system", "ระบบ"],
] as const;

export default function AdminShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.kicker}>MISSAV CONTROL ROOM</p>
            <h1>{title}</h1>
            <p className={styles.description}>{description}</p>
          </div>
          <div className={styles.topActions}>
            <Link className={styles.topLink} href="/admin">สลับ Control Room</Link>
            <Link className={styles.topLink} href="/hub">ดู MISSAV ↗</Link>
            <button
              className={styles.button}
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                window.location.href = "/";
              }}
            >
              ออกจากระบบ
            </button>
          </div>
        </header>

        <nav className={styles.nav} aria-label="เมนูหลังบ้าน MISSAV">
          {nav.map(([href, label]) => {
            const active = href === "/admin/missav" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                href={href}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.content}>{children}</div>
        <p className={styles.footer}>
          Control Room นี้จัดการเฉพาะ catalog และ Player ของ MISSAV เท่านั้น เครื่องมือ AVDBAPI ถูกแยกไปอีกระบบ
        </p>
      </div>
    </main>
  );
}
