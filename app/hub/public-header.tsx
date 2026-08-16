"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SourceSwitcher from "../source-switcher";
import styles from "./hub.module.css";

const links = [
  { href: "/hub", label: "หน้าแรก", exact: true },
  { href: "/hub/movies", label: "หนังทั้งหมด" },
  { href: "/hub/series", label: "ซีรีส์" },
  { href: "/hub#latest", label: "อัปเดตล่าสุด" },
];

export default function PublicHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/hub";

  return <header className={styles.header}>
      <Link href="/hub" className={styles.brand}>MISSAV · <span>CINEMA</span></Link>
      <nav className={styles.nav} aria-label="เมนู MISSAV Cinema">
        {links.map((link) => {
          const active = link.exact ? isHome : pathname.startsWith(link.href);
          return <Link key={link.href} href={link.href} className={active ? styles.navActive : ""}>{link.label}</Link>;
        })}
      </nav>
      <div className={styles.headerActions}>
        <Link className={styles.headerSearch} href="/hub#search">ค้นหา</Link>
        <SourceSwitcher current="missav" />
      </div>
    </header>;
}
