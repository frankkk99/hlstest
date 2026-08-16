import ui from "../../ui-polish.module.css";

export default function AvdbWatchLoading() {
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
