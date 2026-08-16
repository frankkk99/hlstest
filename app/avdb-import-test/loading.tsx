import ui from "../avdb/ui-polish.module.css";

export default function AvdbImportTestLoading() {
  return (
    <main className={ui.pageSkeleton} aria-label="กำลังโหลด AVDB Source Lab">
      <div className={ui.skeletonShell}>
        <div className={ui.skeletonHero} />
        <div className={ui.skeletonChips}>
          {Array.from({ length: 4 }, (_, index) => <span className={ui.skeletonChip} key={index} />)}
        </div>
        <div className={ui.skeletonGrid}>
          {Array.from({ length: 6 }, (_, index) => (
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
