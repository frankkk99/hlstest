import type { ReactNode } from "react";
import AvdbWorkerDriver from "./avdb-worker-driver";

export default function AvdbAdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AvdbWorkerDriver />
      {children}
    </>
  );
}
