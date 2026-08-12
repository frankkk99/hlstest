"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./hub.module.css";
import {
  displayTitle,
  durationLabel,
  imageUrl,
  yearLabel,
  type StorefrontItem,
} from "./storefront";

type CatalogResponse = {
  ok: boolean;
  error?: string;
  total?: number;
  items?: StorefrontItem[];
};

function MovieCard({
  item,
  onSelect,
}: {
  item: StorefrontItem;
  onSelect: (item: StorefrontItem) => void;
}) {
  return (
    <button className={styles.card} type="button" onClick={() => onSelect(item)}>
      <div className={styles.cover}>
        <Image
          src={imageUrl(item.coverUrl)}
          alt={displayTitle(item)}
          fill
          unoptimized
          sizes="(max-width: 760px) 50vw, (max-width: 1120px) 25vw, 16vw"
          onError={(event) => {
            event.currentTarget.src = "/cover-fallback.svg";
          }}
        />
        <span className={styles.coverShade} />
      </div>
      <div className={styles.cardBody}>
        <strong className={styles.cardTitle}>{displayTitle(item)}</strong>
        <div className={styles.cardMeta}>
          <span>{yearLabel(item.releaseDate)}</span>
          <span>{durationLabel(item.durationSeconds)}</span>
        </div>
      </div>
    </button>
  );
}

export default function StorefrontHome() {
  const [items, setItems] = useState<StorefrontItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<StorefrontItem | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  async function loadCatalog(query = "") {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        limit: "48",
        sort: "latest",
        ready: "1",
      });
      if (query.trim()) params.set("search", query.trim());

      const response = await fetch(`/api/catalog?${params.toString()}`, {
        cache: "default",
      });
      const data = (await response.json()) as CatalogResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "ยังโหลดรายการไม่สำเร็จ");
      }

      setItems(data.items || []);
      setTotal(data.total || 0);
      setHeroIndex(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ยังโหลดรายการไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const playableItems = useMemo(() => items.filter((item) => item.hasPlayer), [items]);
  const heroItems = useMemo(() => playableItems.slice(0, 6), [playableItems]);
  const hero = heroItems[Math.min(heroIndex, Math.max(0, heroItems.length - 1))];
  const latestItems = playableItems;

  return (
    <main className={styles.storefront}>
      {hero && (
        <section className={styles.hero} aria-label="เรื่องแนะนำ">
          <div className={styles.heroImage}>
            <Image
              src={imageUrl(hero.coverUrl)}
              alt=""
              fill
              priority
              unoptimized
              sizes="100vw"
              onError={(event) => {
                event.currentTarget.src = "/cover-fallback.svg";
              }}
            />
          </div>
          <div className={styles.container}>
            <div className={styles.heroContent}>
              <p className={styles.heroKicker}>เรื่องเด่นประจำวันนี้</p>
              <h1 className={styles.heroTitle}>{displayTitle(hero)}</h1>
              <p className={styles.heroDescription}>
                {hero.synopsis || "เพลิดเพลินกับรายการแนะนำล่าสุดที่คัดสรรมาให้รับชมได้ง่ายในที่เดียว"}
              </p>
              <div className={styles.heroMeta}>
                <span>{yearLabel(hero.releaseDate)}</span>
                <span>{durationLabel(hero.durationSeconds)}</span>
                <span>{hero.isSeries ? "ซีรีส์" : "ภาพยนตร์"}</span>
              </div>
              <div className={styles.heroActions}>
                <button className={styles.primaryButton} type="button" onClick={() => setSelected(hero)}>
                  ▶ ดูรายละเอียด
                </button>
                <Link className={styles.secondaryButton} href={`/hub/watch/${hero.id}`}>
                  เริ่มรับชม
                </Link>
              </div>
              <div className={styles.heroChoices} aria-label="เลือกเรื่องเด่น">
                {heroItems.map((item, index) => (
                  <button
                    key={item.id}
                    className={`${styles.heroChoice} ${index === heroIndex ? styles.heroChoiceActive : ""}`}
                    type="button"
                    onClick={() => setHeroIndex(index)}
                    aria-label={`เลือกเรื่องเด่นลำดับ ${index + 1}`}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{displayTitle(item)}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.sectionTitle}>ดูหนังออนไลน์</h2>
            <p className={styles.sectionNote}>มีรายการทั้งหมด {total.toLocaleString()} เรื่อง</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void loadCatalog(search);
            }}
          >
            <input
              id="search"
              className={styles.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาชื่อเรื่อง..."
              aria-label="ค้นหาชื่อเรื่อง"
            />
          </form>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.loading}>กำลังเตรียมรายการให้รับชม...</div>
        ) : playableItems.length ? (
          <>
            <section className={styles.row} id="ready">
              <div className={styles.rowHeader}>
                <h2>พร้อมรับชม</h2>
                <span>{latestItems.length} เรื่อง</span>
              </div>
              <div className={styles.cardGrid}>
                {latestItems.map((item) => (
                  <MovieCard key={item.id} item={item} onSelect={setSelected} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className={styles.empty}>ยังไม่มีเรื่องที่พร้อมรับชมในตอนนี้</div>
        )}
      </div>

      {selected && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="รายละเอียดเรื่อง">
            <button className={styles.close} type="button" onClick={() => setSelected(null)} aria-label="ปิด">
              ×
            </button>
            <div className={styles.modalCover}>
              <Image
                src={imageUrl(selected.coverUrl)}
                alt=""
                fill
                unoptimized
                sizes="230px"
                onError={(event) => {
                  event.currentTarget.src = "/cover-fallback.svg";
                }}
              />
            </div>
            <div className={styles.modalContent}>
              <span className={styles.modalLabel}>{selected.isSeries ? "ซีรีส์" : "ภาพยนตร์"}</span>
              <h2 className={styles.modalTitle}>{displayTitle(selected)}</h2>
              <p className={styles.modalDescription}>
                {selected.synopsis || "เรื่องราวน่าติดตาม พร้อมให้คุณรับชมได้แล้ว"}
              </p>
              <div className={styles.modalMeta}>
                <span>{yearLabel(selected.releaseDate)}</span>
                <span>{durationLabel(selected.durationSeconds)}</span>
              </div>
              <div className={styles.modalActions}>
                <Link className={styles.primaryButton} href={`/hub/watch/${selected.id}`}>
                  ▶ รับชมเรื่องนี้
                </Link>
                <button className={styles.secondaryButton} type="button" onClick={() => setSelected(null)}>
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
