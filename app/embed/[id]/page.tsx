"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PlayerGatewayPlayer from "@/components/player-gateway/player-core";
import styles from "./embed.module.css";

type CatalogItem = {
  id: string;
  duration: string | null;
  poster_url: string | null;
  thumb_url: string | null;
};

type DetailResponse = { ok: boolean; error?: string; item?: CatalogItem };

export default function PlayerGatewayEmbedPage() {
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
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Player unavailable"); });
    return () => { active = false; };
  }, [id]);

  if (!item) return <main className={styles.page}><span>{error || ""}</span></main>;

  return (
    <main className={styles.page}>
      <PlayerGatewayPlayer
        catalogId={item.id}
        poster={item.thumb_url || item.poster_url || ""}
        duration={item.duration}
      />
    </main>
  );
}
