import Link from "next/link";
import styles from "./source-switcher.module.css";

type SourceName = "missav" | "avdb";

const sourceConfig = {
  missav: {
    currentLabel: "MISSAV",
    targetLabel: "AVDB",
    href: "/avdb",
    aria: "สลับจาก MISSAV ไป AVDBAPI",
  },
  avdb: {
    currentLabel: "AVDB",
    targetLabel: "MISSAV",
    href: "/hub",
    aria: "สลับจาก AVDBAPI ไป MISSAV",
  },
} as const;

export default function SourceSwitcher({ current }: { current: SourceName }) {
  const config = sourceConfig[current];

  return (
    <Link
      href={config.href}
      className={`${styles.switcher} ${styles[current]}`}
      aria-label={config.aria}
      title={config.aria}
    >
      <span className={styles.current}>
        <span className={styles.dot} aria-hidden="true" />
        {config.currentLabel}
      </span>
      <span className={styles.switchIcon} aria-hidden="true">⇄</span>
      <span className={styles.target}>{config.targetLabel}</span>
    </Link>
  );
}
