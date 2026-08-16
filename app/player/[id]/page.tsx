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
  player_provider?: string | null;
};

type DetailResponse = { ok: boolean; error?: string; item?: CatalogItem };

const GATEWAY_ORIGIN = "https://dev2u.online";

export default function PlayerGatewayTestPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/avdb/catalog/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as DetailResponse;
        if (!response.ok || !payload.ok || !payload.item) throw new Error(payload.error || "ไม่พบรายการนี้");
        if (active) setItem(payload.item);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "เปิดหน้าเทสไม่สำเร็จ"); });
    return () => { active = false; };
  }, [id]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1400);
    } catch {
      setCopied("");
    }
  }

  if (!item) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>{error || "กำลังเตรียมหน้า Test Player…"}</div>
      </main>
    );
  }

  const poster = item.thumb_url || item.poster_url || "";
  const code = item.movie_code || item.external_id || "AVDB";
  const embedUrl = `${GATEWAY_ORIGIN}/embed/${item.id}`;
  const wrapper = `<iframe src="${embedUrl}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="eager" style="width:100%;aspect-ratio:16/9;border:0"></iframe>`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>PLAYER<span>TEST</span></Link>
        <Link href="/" className={styles.back}>← กลับรายการ Wrapper</Link>
      </header>

      <div className={styles.shell}>
        <div className={styles.testHead}>
          <div>
            <span>TEST PLAYER</span>
            <h1>{item.title}</h1>
          </div>
          <div className={styles.meta}>
            <span>{code}</span>
            {item.quality ? <span>{item.quality}</span> : null}
            {item.duration ? <span>{item.duration}</span> : null}
            {item.player_provider ? <span>{item.player_provider}</span> : null}
          </div>
        </div>

        <div className={styles.playerBox}>
          <PlayerGatewayPlayer catalogId={item.id} poster={poster} duration={item.duration} showStatus />
        </div>

        <section className={styles.wrapperPanel}>
          <div className={styles.wrapperHead}>
            <div>
              <strong>Wrapper พร้อมใช้</strong>
              <span>{embedUrl}</span>
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={() => void copy(wrapper, "wrap")}>{copied === "wrap" ? "คัดลอกแล้ว" : "คัดลอก Wrap"}</button>
              <button type="button" onClick={() => void copy(embedUrl, "url")}>{copied === "url" ? "คัดลอกแล้ว" : "คัดลอก URL"}</button>
              <a href={embedUrl} target="_blank" rel="noreferrer">เปิด Embed</a>
            </div>
          </div>
          <code>{wrapper}</code>
        </section>
      </div>
    </main>
  );
}
