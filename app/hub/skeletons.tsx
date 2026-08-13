import hubStyles from "./hub.module.css";
import browseStyles from "./browse.module.css";

const cardSlots = Array.from({ length: 12 }, (_, index) => index);
const relatedSlots = Array.from({ length: 6 }, (_, index) => index);

function SkeletonBlock({ className }: { className: string }) {
  return <span className={`${hubStyles.skeletonBlock} ${className}`} aria-hidden="true" />;
}

function BrowseSkeletonBlock({ className }: { className: string }) {
  return <span className={`${browseStyles.skeletonBlock} ${className}`} aria-hidden="true" />;
}

function HomeSkeletonCard() {
  return <div className={hubStyles.skeletonCard} aria-hidden="true">
    <SkeletonBlock className={hubStyles.skeletonCover} />
    <div className={hubStyles.skeletonCardBody}>
      <SkeletonBlock className={hubStyles.skeletonTitle} />
      <SkeletonBlock className={hubStyles.skeletonMeta} />
    </div>
  </div>;
}

function BrowseSkeletonCard() {
  return <div className={browseStyles.skeletonCard} aria-hidden="true">
    <BrowseSkeletonBlock className={browseStyles.skeletonCover} />
    <div className={browseStyles.skeletonCardBody}>
      <BrowseSkeletonBlock className={browseStyles.skeletonTitle} />
      <BrowseSkeletonBlock className={browseStyles.skeletonMeta} />
    </div>
  </div>;
}

export function HomeSkeleton() {
  return <div className={hubStyles.skeletonHome} aria-busy="true" aria-label="กำลังโหลดหน้าแรก">
    <section className={hubStyles.skeletonHero}>
      <div className={hubStyles.container}>
        <div className={hubStyles.skeletonHeroContent}>
          <SkeletonBlock className={hubStyles.skeletonHeroKicker} />
          <SkeletonBlock className={hubStyles.skeletonHeroTitle} />
          <SkeletonBlock className={hubStyles.skeletonHeroTitleShort} />
          <SkeletonBlock className={hubStyles.skeletonHeroDescription} />
          <SkeletonBlock className={hubStyles.skeletonHeroDescriptionShort} />
          <div className={hubStyles.skeletonHeroMeta}>
            <SkeletonBlock className={hubStyles.skeletonPill} />
            <SkeletonBlock className={hubStyles.skeletonPillSmall} />
            <SkeletonBlock className={hubStyles.skeletonPillSmall} />
          </div>
          <div className={hubStyles.skeletonHeroActions}>
            <SkeletonBlock className={hubStyles.skeletonButton} />
            <SkeletonBlock className={hubStyles.skeletonButtonSecondary} />
          </div>
          <div className={hubStyles.skeletonHeroChoices}>
            {Array.from({ length: 6 }, (_, index) => <SkeletonBlock key={index} className={hubStyles.skeletonChoice} />)}
          </div>
        </div>
      </div>
    </section>
    <div className={hubStyles.container}>
      <div className={hubStyles.skeletonToolbar}>
        <div>
          <SkeletonBlock className={hubStyles.skeletonSectionTitle} />
          <SkeletonBlock className={hubStyles.skeletonSectionNote} />
        </div>
        <SkeletonBlock className={hubStyles.skeletonSearch} />
      </div>
      <section className={hubStyles.row}>
        <div className={hubStyles.rowHeader}>
          <SkeletonBlock className={hubStyles.skeletonRowTitle} />
          <SkeletonBlock className={hubStyles.skeletonRowCount} />
        </div>
        <div className={hubStyles.cardGrid}>
          {cardSlots.map((slot) => <HomeSkeletonCard key={slot} />)}
        </div>
      </section>
    </div>
  </div>;
}

export function BrowseSkeleton() {
  return <div className={browseStyles.skeletonPage} aria-busy="true" aria-label="กำลังโหลดรายการ">
    <div className={browseStyles.container}>
      <div className={browseStyles.skeletonTopline}>
        <div>
          <BrowseSkeletonBlock className={browseStyles.skeletonKicker} />
          <BrowseSkeletonBlock className={browseStyles.skeletonHeading} />
          <BrowseSkeletonBlock className={browseStyles.skeletonSubheading} />
        </div>
        <BrowseSkeletonBlock className={browseStyles.skeletonCount} />
      </div>
      <div className={browseStyles.skeletonSearchbar}>
        <BrowseSkeletonBlock className={browseStyles.skeletonSearchInput} />
        <BrowseSkeletonBlock className={browseStyles.skeletonSearchButton} />
      </div>
      <div className={browseStyles.grid}>
        {cardSlots.map((slot) => <BrowseSkeletonCard key={slot} />)}
      </div>
    </div>
  </div>;
}

export function WatchSkeleton() {
  return <main className={hubStyles.watch} aria-busy="true" aria-label="กำลังเตรียมหน้ารับชม">
    <div className={hubStyles.container}>
      <SkeletonBlock className={hubStyles.skeletonBack} />
      <section className={hubStyles.skeletonWatchPlayer}>
        <div className={hubStyles.skeletonPlayButton} />
      </section>
      <section className={hubStyles.skeletonWatchInfo}>
        <div>
          <SkeletonBlock className={hubStyles.skeletonWatchTitle} />
          <SkeletonBlock className={hubStyles.skeletonWatchMeta} />
          <SkeletonBlock className={hubStyles.skeletonWatchDescription} />
          <SkeletonBlock className={hubStyles.skeletonWatchDescriptionShort} />
        </div>
        <SkeletonBlock className={hubStyles.skeletonWatchMessage} />
      </section>
      <section className={hubStyles.related}>
        <div className={hubStyles.rowHeader}>
          <SkeletonBlock className={hubStyles.skeletonRowTitle} />
          <SkeletonBlock className={hubStyles.skeletonRowCount} />
        </div>
        <div className={hubStyles.cardGrid}>
          {relatedSlots.map((slot) => <HomeSkeletonCard key={slot} />)}
        </div>
      </section>
    </div>
  </main>;
}
