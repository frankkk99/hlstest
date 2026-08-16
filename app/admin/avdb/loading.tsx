import polish from "./admin-polish.module.css";

export default function AvdbAdminLoading() {
  return (
    <main className={polish.skeletonPage} aria-label="กำลังโหลด AVDB Admin">
      <div className={polish.skeletonShell}>
        <div className={polish.skeletonBar} />
        <div className={polish.skeletonHero} />
        <div className={polish.skeletonStats}>
          {Array.from({ length: 6 }, (_, index) => <div className={polish.skeletonTile} key={index} />)}
        </div>
        <div className={polish.skeletonWork}>
          <div className={polish.skeletonPanel} />
          <div className={polish.skeletonSide}>
            <div className={polish.skeletonPanel} />
            <div className={polish.skeletonPanel} />
          </div>
        </div>
      </div>
    </main>
  );
}
