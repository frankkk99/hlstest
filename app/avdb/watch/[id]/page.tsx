"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PlayerGatewayPlayer from "@/components/player-gateway/player-core";
import SourceSwitcher from "../../../source-switcher";
import ExpandableText from "../../expandable-text";
import ui from "../../ui-polish.module.css";
import styles from "./watch.module.css";

type CatalogItem = {
  id: string;
  stage_item_id: string;
  external_id: string | null;
  movie_code: string | null;
  title: string;
  original_title: string | null;
  year: string | null;
  quality: string | null;
  duration: string | null;
  description: string | null;
  poster_url: string | null;
  thumb_url: string | null;
  player_provider: string | null;
  published_at: string;
};

type DetailResponse = { ok: boolean; error?: string; item?: CatalogItem };
type CatalogResponse = { ok: boolean; items?: CatalogItem[] };

function WatchSkeleton() {
  return (
    <main className={ui.pageSkeleton} aria-label="กำลังโหลดหน้าดู AVDB">
      <div className={ui.skeletonShell}>
        <div className={`${ui.skeletonHero} ${ui.watchSkeletonPlayer}`} />
        <div className={ui.watchSkeletonInfo}>
          <span className={ui.skeletonLine} />
          <span className={ui.skeletonLine} />
          <span className={ui.skeletonLine} />
        </div>
        <div className={ui.skeletonGrid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={ui.skeletonCard} key={index}>
              <div className={ui.skeletonCardImage} />
              <span className={ui.skeletonCardLine} />
              <span className={ui.skeletonCardLine} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function AvdbWatchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [related, setRelated] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [detailResponse, relatedResponse] = await Promise.all([
          fetch(`/api/avdb/catalog/${encodeURIComponent(id)}`, { cache: "no-store" }),
          fetch("/api/avdb/catalog?limit=8", { cache: "no-store" }),
        ]);
        const detail = (await detailResponse.json()) as DetailResponse;
        const catalog = (await relatedResponse.json()) as CatalogResponse;
        if (!detailResponse.ok || !detail.ok || !detail.item) throw new Error(detail.error || "ไม่พบรายการนี้");
        if (!active) return;
        setItem(detail.item);
        setRelated((catalog.items || []).filter((entry) => entry.id !== detail.item?.id).slice(0, 6));
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "เปิดรายการนี้ไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) return <WatchSkeleton />;

  if (!item) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>
          <div className={styles.emptyBox}>
            <strong>ไม่พบรายการนี้</strong>
            <p>{message}</p>
            <Link href="/avdb">กลับหน้าแรก</Link>
          </div>
        </div>
      </main>
    );
  }

  const poster = item.thumb_url || item.poster_url || "";
  const code = item.movie_code || item.external_id || "AVDB";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/avdb" className={styles.brand}>AVDB<span>INDEX</span></Link>
        <Link href="/avdb" className={styles.back}>← กลับหน้าแรก</Link>
        <SourceSwitcher current="avdb" />
      </header>

      <div className={styles.shell}>
        <div className={styles.gatewayPlayerShell}>
          <PlayerGatewayPlayer catalogId={item.id} poster={poster} duration={item.duration} showStatus />
        </div>

        <section className={styles.watchInfo}>
          <div className={styles.infoMain}>
            <p className={styles.code}>{code}</p>
            <ExpandableText as="h1" lines={3} text={item.title} className={styles.title} />
            {item.original_title && item.original_title !== item.title ? (
              <ExpandableText as="p" lines={3} text={item.original_title} className={styles.original} />
            ) : null}
            <div className={styles.meta}>
              {item.year ? <span>{item.year}</span> : null}
              {item.quality ? <span>{item.quality}</span> : null}
              {item.duration ? <span>{item.duration}</span> : null}
            </div>
            {item.description ? <ExpandableText as="p" lines={3} text={item.description} className={styles.description} /> : null}
          </div>
          <Link className={styles.gatewayLink} href={`/player/${item.id}`}>เปิด Player Gateway ↗</Link>
        </section>

        {related.length ? (
          <section className={styles.related}>
            <div className={styles.sectionHead}><h2>เรื่องอื่นที่น่าสนใจ</h2><span>เลือกดูต่อ</span></div>
            <div className={styles.grid}>
              {related.map((entry) => (
                <Link className={styles.card} href={`/avdb/watch/${entry.id}`} key={entry.id}>
                  <div className={styles.cover}>{entry.thumb_url || entry.poster_url ? <img src={entry.thumb_url || entry.poster_url || ""} alt="" loading="lazy" /> : null}</div>
                  <div className={styles.cardBody}><strong className={ui.cardTitle3}>{entry.title}</strong><span>{entry.movie_code || entry.duration || "AVDB"}</span></div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
