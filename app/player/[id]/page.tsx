"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PlayerGatewayPlayer from "@/components/player-gateway/player-core";
import styles from "./player.module.css";

type CatalogItem = {
  id: string;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  poster_url: string | null;
  thumb_url: string | null;
};

type DetailResponse = { ok: boolean; error?: string; item?: CatalogItem };

export default function PlayerGatewayPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/avdb/catalog/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as DetailResponse;
        if (!response.ok || !payload.ok || !payload.item) throw new Error(payload.error || "ไม่พบรายการนี้");
        if (active) setItem(payload.item);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "เปิด Player ไม่สำเร็จ"); });
    return () => { active = false; };
  }, [id]);

  if (!item) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>{error || "กำลังเตรียม Player Gateway…"}</div>
      </main>
    );
  }

  const poster = item.thumb_url || item.poster_url || "";
  const code = item.movie_code || item.external_id || "AVDB";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>PLAYER<span>GATEWAY</span></Link>
        <Link href="/avdb" className={styles.back}>AVDB ↗</Link>
      </header>

      <div className={styles.shell}>
        <div className={styles.playerBox}>
          <PlayerGatewayPlayer catalogId={item.id} poster={poster} duration={item.duration} showStatus />
        </div>

        <section className={styles.info}>
          <p>{code}</p>
          <h1>{item.title}</h1>
          <div className={styles.meta}>
            {item.year ? <span>{item.year}</span> : null}
            {item.quality ? <span>{item.quality}</span> : null}
            {item.duration ? <span>{item.duration}</span> : null}
          </div>
          <code>{`<iframe src="https://dev2u.online/embed/${item.id}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`}</code>
        </section>
      </div>
    </main>
  );
}
