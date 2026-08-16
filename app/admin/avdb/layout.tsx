import type { ReactNode } from "react";
import AvdbPlayerConsole from "./avdb-player-console";
import AvdbPublishConsole from "./avdb-publish-console";
import AvdbWorkerDriver from "./avdb-worker-driver";

export default function AvdbAdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AvdbWorkerDriver />
      {children}
      <AvdbPublishConsole />
      <AvdbPlayerConsole />
    </>
  );
}
