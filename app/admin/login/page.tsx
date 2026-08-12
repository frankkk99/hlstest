"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/admin")) setNextPath(next);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next: nextPath }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; next?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "เข้าสู่ระบบไม่สำเร็จ");
      router.replace(data.next || "/admin");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <p className={styles.kicker}>HLSHUB ADMIN</p>
      <h1>เข้าสู่ระบบหลังบ้าน</h1>
      <p className={styles.description}>หน้านี้สำหรับจัดการข้อมูลและตรวจสอบ Player เท่านั้น</p>
      <form onSubmit={submit}>
        <label className={styles.label} htmlFor="password">รหัสผ่าน</label>
        <input className={styles.input} id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.button} type="submit" disabled={loading}>{loading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}</button>
      </form>
      <a className={styles.back} href="/">← กลับหน้าเว็บ</a>
    </section>
  </main>;
}
