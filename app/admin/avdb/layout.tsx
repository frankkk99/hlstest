import type { ReactNode } from "react";
import AvdbMoreLoader from "./avdb-more-loader";
import AvdbPlayerConsole from "./avdb-player-console";
import AvdbPublishConsole from "./avdb-publish-console";
import AvdbWorkerDriver from "./avdb-worker-driver";

export default function AvdbAdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AvdbWorkerDriver />
      {children}
      <AvdbMoreLoader />
      <AvdbPublishConsole />
      <AvdbPlayerConsole />
    </>
  );
}
