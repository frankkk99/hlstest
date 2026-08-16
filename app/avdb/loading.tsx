import styles from "./loading.module.css";

export default function AvdbLoading() {
  return (
    <main className={styles.page} role="status" aria-label="กำลังโหลด">
      <span className={styles.spinner} aria-hidden="true" />
    </main>
  );
}
